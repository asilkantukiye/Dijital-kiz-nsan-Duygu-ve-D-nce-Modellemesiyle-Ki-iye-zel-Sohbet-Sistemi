import { createClient } from '@/lib/supabase-server'
import { HuggingFaceEmbeddingProvider } from '@/lib/huggingface'
import { validateEmbeddingVector } from '@/lib/embedding-validation'

import { extractMemories, MEMORY_DUPLICATE_SIMILARITY_THRESHOLD, planPreferenceReplacement, type MemoryItem } from '@/lib/memory-text'

export { extractMemories, formatMemoryContext } from '@/lib/memory-text'
export type { MemoryItem, MemoryType } from '@/lib/memory-text'

const MIN_SIMILARITY = 0.72
// Engineering parameter, not a scientifically validated semantic boundary.
const MAX_MEMORY_RESULTS = 5
const MAX_MEMORY_ITEMS_PER_USER = 50
const MEMORY_RETENTION_DAYS = 180
const MEMORY_PRUNE_BATCH_SIZE = 250
const MAX_PRUNE_BATCHES_PER_PASS = 4
const MAX_PRUNE_FILTER_CLAUSES = 64
const MEMORY_RETENTION_MS = MEMORY_RETENTION_DAYS * 24 * 60 * 60 * 1000

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>

async function assertMemoryUserContext(supabase: ServerSupabaseClient, userId: string) {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user || user.id !== userId) {
    throw new Error('Memory ownership context does not match the authenticated user.')
  }
  return user.id
}

async function pruneNeverUsedMemories(supabase: ServerSupabaseClient, userId: string, cutoff: string) {
  for (let batch = 0; batch < MAX_PRUNE_BATCHES_PER_PASS; batch += 1) {
    const { data, error } = await supabase.from('memory_items').select('id').eq('user_id', userId).is('last_used_at', null).lt('updated_at', cutoff).order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(MEMORY_PRUNE_BATCH_SIZE)
    if (error) throw error
    const ids = (data ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) break
    const { error: deleteError } = await supabase.from('memory_items').delete().eq('user_id', userId).in('id', ids).is('last_used_at', null).lt('updated_at', cutoff)
    if (deleteError) throw deleteError
  }
}

async function pruneInactiveMemories(supabase: ServerSupabaseClient, userId: string, cutoff: string) {
  for (let batch = 0; batch < MAX_PRUNE_BATCHES_PER_PASS; batch += 1) {
    const { data, error } = await supabase.from('memory_items').select('id').eq('user_id', userId).not('last_used_at', 'is', null).lt('updated_at', cutoff).lt('last_used_at', cutoff).order('last_used_at', { ascending: true }).order('updated_at', { ascending: true }).order('id', { ascending: true }).limit(MEMORY_PRUNE_BATCH_SIZE)
    if (error) throw error
    const ids = (data ?? []).map((item) => item.id).filter((id): id is string => typeof id === 'string')
    if (ids.length === 0) break
    const { error: deleteError } = await supabase.from('memory_items').delete().eq('user_id', userId).in('id', ids).not('last_used_at', 'is', null).lt('updated_at', cutoff).lt('last_used_at', cutoff)
    if (deleteError) throw deleteError
  }
}

async function pruneMemoryLifecycle(supabase: ServerSupabaseClient, userId: string) {
  const cutoff = new Date(Date.now() - MEMORY_RETENTION_MS).toISOString()
  // Each pass is bounded. Remaining rows resume on the next memory operation.
  await pruneNeverUsedMemories(supabase, userId, cutoff)
  await pruneInactiveMemories(supabase, userId, cutoff)
  for (let batch = 0; batch < MAX_PRUNE_BATCHES_PER_PASS; batch += 1) {
    const { data, error } = await supabase.from('memory_items').select('id,updated_at,last_used_at').eq('user_id', userId).order('updated_at', { ascending: false }).order('id', { ascending: true }).range(MAX_MEMORY_ITEMS_PER_USER, MAX_MEMORY_ITEMS_PER_USER + MEMORY_PRUNE_BATCH_SIZE - 1)
    if (error) throw error
    const rows = (data ?? []).filter((item): item is { id: string; updated_at: string; last_used_at: string | null } => typeof item.id === 'string' && typeof item.updated_at === 'string' && (typeof item.last_used_at === 'string' || item.last_used_at === null))
    if (rows.length === 0) break

    // Delete only the exact versions selected. Concurrent content updates change
    // updated_at; retrievals change last_used_at. Either change must protect the row.
    for (let offset = 0; offset < rows.length; offset += MAX_PRUNE_FILTER_CLAUSES) {
      const chunk = rows.slice(offset, offset + MAX_PRUNE_FILTER_CLAUSES)
      const ids = chunk.map((row) => row.id)
      const updatedSnapshotFilter = chunk.map((row) => {
        const activityPredicate = row.last_used_at === null
          ? 'last_used_at.is.null'
          : `last_used_at.eq.${row.last_used_at}`
        return `and(id.eq.${row.id},updated_at.eq.${row.updated_at},${activityPredicate})`
      }).join(',')
      const { error: deleteError } = await supabase.from('memory_items').delete().eq('user_id', userId).in('id', ids).or(updatedSnapshotFilter)
      if (deleteError) throw deleteError
    }

    if (rows.length < MEMORY_PRUNE_BATCH_SIZE) break
  }
}

export async function retrieveMemories(userId: string, queryText: string) {
  const supabase = await createClient()
  await assertMemoryUserContext(supabase, userId)

  // Retrieval is read-only until the chat turn has committed. A model timeout or
  // provider error must not mutate memory usage timestamps or prune stored rows.
  // Avoid an external embedding call while the user has no stored memories.
  const { data: existing, error: existingError } = await supabase
    .from('memory_items')
    .select('id')
    .eq('user_id', userId)
    .limit(1)

  if (existingError) throw existingError
  if (!existing || existing.length === 0) return []

  const embedder = new HuggingFaceEmbeddingProvider()
  const embedding = validateEmbeddingVector(await embedder.embed(queryText, 'query'))

  const { data, error } = await supabase.rpc('match_memory_items', {
    query_embedding: embedding,
    match_threshold: MIN_SIMILARITY,
    match_count: MAX_MEMORY_RESULTS
  })

  if (error) throw error

  const memories = (data ?? []) as MemoryItem[]

  return memories
}

export async function finalizeMemoryTurn(userId: string, memoryIds: string[]) {
  const supabase = await createClient()
  await assertMemoryUserContext(supabase, userId)

  const ids = [...new Set(memoryIds.filter(
    (id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)
  ))].slice(0, MAX_MEMORY_RESULTS)

  if (ids.length > 0) {
    const { error } = await supabase
      .from('memory_items')
      .update({ last_used_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', ids)

    if (error) throw error
  }

  // Maintenance is also deferred until a complete chat turn has committed.
  await pruneMemoryLifecycle(supabase, userId)
}

export async function persistMemories(
  userId: string,
  sourceMessageId: string,
  sourceText: string
) {
  const supabase = await createClient()
  const authenticatedUserId = await assertMemoryUserContext(supabase, userId)

  const extracted = extractMemories(sourceText)
  if (extracted.length === 0) return 0

  // Fail before embedding/provider work if the supplied source ID is not this
  // authenticated user's own user-message row. The composite SQL FK remains the
  // authoritative protection against races and crafted database writes.
  const { data: sourceMessage, error: sourceMessageError } = await supabase
    .from('messages')
    .select('id, role')
    .eq('id', sourceMessageId)
    .eq('user_id', authenticatedUserId)
    .maybeSingle()

  if (sourceMessageError) throw sourceMessageError
  if (!sourceMessage || sourceMessage.role !== 'user') {
    throw new Error('Memory source message is not an owned user message.')
  }

  const embedder = new HuggingFaceEmbeddingProvider()
  const candidates = extracted.slice(0, 4)

  const embedded = await Promise.all(
    candidates.map(async (memory) => ({
      memory,
      embedding: validateEmbeddingVector(await embedder.embed(memory.content, 'passage'))
    }))
  )

  let persisted = 0

  for (const item of embedded) {
    const now = new Date().toISOString()

    // Explicitly stated preferences get a deterministic same-topic lookup first.
    // This handles direct statements such as "Şekerli kahve içerim" without
    // requiring the word "Artık". Vector similarity alone never decides conflicts.
    if (item.memory.replaceExisting && item.memory.memory_type === 'preference') {
      const { data: preferenceRows, error: preferenceError } = await supabase
        .from('memory_items')
        .select('id, content, updated_at')
        .eq('user_id', userId)
        .eq('memory_type', 'preference')
        .order('updated_at', { ascending: false })
        .limit(MAX_MEMORY_ITEMS_PER_USER)

      if (preferenceError) throw preferenceError

      const replacementPlan = planPreferenceReplacement(
        preferenceRows ?? [],
        item.memory.content
      )

      if (replacementPlan) {
        // One SECURITY INVOKER RPC updates the chosen row and removes stale
        // same-topic rows in a single PostgreSQL transaction.
        const { error: replacementError } = await supabase.rpc('replace_my_memory_preference', {
          p_keep_id: replacementPlan.keep.id,
          p_duplicate_ids: replacementPlan.remove.map((row) => row.id),
          p_content: item.memory.content,
          p_importance: item.memory.importance,
          p_embedding: item.embedding,
          p_source_message_id: sourceMessageId
        })

        if (replacementError) throw replacementError

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

    if (similar.length > 0) {
      // A deterministic same-topic replacement has already been handled above.
      // If no matching topic exists, similarity alone must not overwrite another
      // preference or create another near-duplicate memory.
      continue
    }

    // The SQL RPC takes the shared per-user transaction lock and rechecks the
    // source message inside the same transaction. If account deletion won the
    // race while embeddings were being generated, the source no longer exists
    // and this write fails instead of resurrecting memory after deletion.
    const { error } = await supabase.rpc('persist_my_memory_item', {
      p_source_message_id: sourceMessageId,
      p_memory_type: item.memory.memory_type,
      p_content: item.memory.content,
      p_importance: item.memory.importance,
      p_embedding: item.embedding
    })

    if (error) throw error
    persisted += 1
  }

  await pruneMemoryLifecycle(supabase, userId)
  return persisted
}
