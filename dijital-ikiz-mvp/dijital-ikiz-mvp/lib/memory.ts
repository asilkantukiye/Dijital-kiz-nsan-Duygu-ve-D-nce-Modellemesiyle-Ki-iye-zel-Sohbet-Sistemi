import { createClient } from '@/lib/supabase-server'
import { HuggingFaceEmbeddingProvider } from '@/lib/huggingface'

import { extractMemories, findConflictingPreferences, MEMORY_DUPLICATE_SIMILARITY_THRESHOLD, type MemoryItem } from '@/lib/memory-text'

export { extractMemories, formatMemoryContext } from '@/lib/memory-text'
export type { MemoryItem, MemoryType } from '@/lib/memory-text'

const MIN_SIMILARITY = 0.72
// Engineering parameter, not a scientifically validated semantic boundary.
const MAX_MEMORY_RESULTS = 5
const MAX_MEMORY_ITEMS_PER_USER = 50
const MEMORY_RETENTION_DAYS = 180
const MEMORY_PRUNE_BATCH_SIZE = 500
const MEMORY_RETENTION_MS = MEMORY_RETENTION_DAYS * 24 * 60 * 60 * 1000

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

async function pruneMemoryLifecycle(supabase: ServerSupabaseClient, userId: string) {
  const cutoff = new Date(Date.now() - MEMORY_RETENTION_MS).toISOString()

  // A memory is stale only when both its last update and last use are old.
  // Rows that have never been used use updated_at as their activity timestamp.
  const { error: neverUsedError } = await supabase
    .from('memory_items')
    .delete()
    .eq('user_id', userId)
    .is('last_used_at', null)
    .lt('updated_at', cutoff)

  if (neverUsedError) throw neverUsedError

  const { error: inactiveError } = await supabase
    .from('memory_items')
    .delete()
    .eq('user_id', userId)
    .not('last_used_at', 'is', null)
    .lt('updated_at', cutoff)
    .lt('last_used_at', cutoff)

  if (inactiveError) throw inactiveError

  // Keep only the newest records for this account. Delete in batches so users
  // who already have an oversized memory table are brought back under the cap.
  while (true) {
    const { data, error } = await supabase
      .from('memory_items')
      .select('id')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(MAX_MEMORY_ITEMS_PER_USER, MAX_MEMORY_ITEMS_PER_USER + MEMORY_PRUNE_BATCH_SIZE - 1)

    if (error) throw error
    const ids = (data ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) break

    const { error: deleteError } = await supabase
      .from('memory_items')
      .delete()
      .eq('user_id', userId)
      .in('id', ids)

    if (deleteError) throw deleteError
    if (ids.length < MEMORY_PRUNE_BATCH_SIZE) break
  }
}

export async function retrieveMemories(userId: string, queryText: string) {
  const supabase = await createClient()
  await pruneMemoryLifecycle(supabase, userId)

  // Avoid an external embedding call while the user has no stored memories.
  const { data: existing, error: existingError } = await supabase
    .from('memory_items')
    .select('id')
    .eq('user_id', userId)
    .limit(1)

  if (existingError) throw existingError
  if (!existing || existing.length === 0) return []

  const embedder = new HuggingFaceEmbeddingProvider()
  const embedding = await embedder.embed(queryText, 'query')

  const { data, error } = await supabase.rpc('match_memory_items', {
    query_embedding: embedding,
    match_threshold: MIN_SIMILARITY,
    match_count: MAX_MEMORY_RESULTS
  })

  if (error) throw error

  const memories = (data ?? []) as MemoryItem[]

  if (memories.length > 0) {
    const ids = memories.map((item) => item.id)
    const { error: updateError } = await supabase
      .from('memory_items')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', ids)

    if (updateError) throw updateError
  }

  return memories
}

export async function persistMemories(
  userId: string,
  sourceMessageId: string,
  sourceText: string
) {
  const extracted = extractMemories(sourceText)
  if (extracted.length === 0) return 0

  const supabase = await createClient()
  const embedder = new HuggingFaceEmbeddingProvider()
  const candidates = extracted.slice(0, 4)

  const embedded = await Promise.all(
    candidates.map(async (memory) => ({
      memory,
      embedding: await embedder.embed(memory.content, 'passage')
    }))
  )

  let persisted = 0

  for (const item of embedded) {
    const now = new Date().toISOString()

    // Explicit preference changes get a deterministic same-topic lookup first.
    // Vector similarity alone cannot reliably match opposites such as sweetened
    // and unsweetened coffee, so it must not decide preference conflicts by itself.
    if (item.memory.replaceExisting && item.memory.memory_type === 'preference') {
      const { data: preferenceRows, error: preferenceError } = await supabase
        .from('memory_items')
        .select('id, content, updated_at')
        .eq('user_id', userId)
        .eq('memory_type', 'preference')
        .order('updated_at', { ascending: false })
        .limit(MAX_MEMORY_ITEMS_PER_USER)

      if (preferenceError) throw preferenceError

      const conflictingRows = findConflictingPreferences(
        preferenceRows ?? [],
        item.memory.content
      )

      if (conflictingRows.length > 0) {
        // Prefer the most recently updated row; remove stale same-topic rows
        // so old contradictory values cannot be retrieved alongside the new one.
        // Reuse an existing exact-content row when one exists. This avoids
        // hitting the (user_id, content) unique index before stale topic rows
        // can be removed.
        const previous =
          conflictingRows.find((row) => row.content === item.memory.content) ??
          conflictingRows[0]
        const { error: updateError } = await supabase
          .from('memory_items')
          .update({
            content: item.memory.content,
            importance: item.memory.importance,
            embedding: item.embedding,
            source_message_id: sourceMessageId,
            updated_at: now
          })
          .eq('user_id', userId)
          .eq('id', previous.id)

        if (updateError) throw updateError

        const duplicateIds = conflictingRows
          .filter((row) => row.id !== previous.id)
          .map((row) => row.id)
        if (duplicateIds.length > 0) {
          const { error: deleteError } = await supabase
            .from('memory_items')
            .delete()
            .eq('user_id', userId)
            .eq('memory_type', 'preference')
            .in('id', duplicateIds)

          if (deleteError) throw deleteError
        }

        persisted += 1
        continue
      }
    }

    // The RPC is scoped by auth.uid(); the explicit user filter on preference
    // lookups and writes is defense in depth.
    const { data: similarRows, error: similarityError } = await supabase.rpc('match_memory_items', {
      query_embedding: item.embedding,
      match_threshold: MEMORY_DUPLICATE_SIMILARITY_THRESHOLD,
      match_count: 10
    })

    if (similarityError) throw similarityError

    const similar = ((similarRows ?? []) as MemoryItem[]).filter(
      (row) => row.memory_type === item.memory.memory_type &&
        typeof row.similarity === 'number' &&
        row.similarity >= MEMORY_DUPLICATE_SIMILARITY_THRESHOLD
    )

    if (similar.length > 0 && !item.memory.replaceExisting) {
      // Ordinary near-duplicates are skipped. Explicit preference changes that
      // did not match a known topic are allowed to become new records rather
      // than overwrite a potentially unrelated preference by vector score alone.
      continue
    }

    const { error } = await supabase
      .from('memory_items')
      .upsert(
        {
          user_id: userId,
          memory_type: item.memory.memory_type,
          content: item.memory.content,
          importance: item.memory.importance,
          embedding: item.embedding,
          source_message_id: sourceMessageId,
          updated_at: now
        },
        { onConflict: 'user_id,content' }
      )

    if (error) throw error
    persisted += 1
  }

  await pruneMemoryLifecycle(supabase, userId)
  return persisted
}
