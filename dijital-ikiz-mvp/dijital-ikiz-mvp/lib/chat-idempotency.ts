import { createHash, randomUUID } from 'node:crypto'

export type ChatClaimDisposition = 'claimed' | 'replay' | 'in_progress'

export type ChatRequestClaim = {
  disposition: ChatClaimDisposition
  response?: unknown
}

export function hashChatRequest(variant: 'personalized' | 'baseline', message: string): string {
  return createHash('sha256')
    .update(JSON.stringify([variant, message]), 'utf8')
    .digest('hex')
}

export function createChatRequestOwnerToken(): string {
  return randomUUID()
}

/**
 * Claiming happens in PostgreSQL, not in process memory, so this also works
 * across separate/serverless application instances. While another owner is
 * active, repeat the atomic claim RPC until it completes or the wait budget ends.
 */
export async function claimChatRequestWithWait(
  claim: () => Promise<ChatRequestClaim>,
  options: { waitMs?: number; pollIntervalMs?: number } = {}
): Promise<ChatRequestClaim> {
  const waitMs = Math.max(0, options.waitMs ?? 1800)
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 150)
  const deadline = Date.now() + waitMs
  let result = await claim()

  while (result.disposition === 'in_progress' && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs))
    result = await claim()
  }

  return result
}
