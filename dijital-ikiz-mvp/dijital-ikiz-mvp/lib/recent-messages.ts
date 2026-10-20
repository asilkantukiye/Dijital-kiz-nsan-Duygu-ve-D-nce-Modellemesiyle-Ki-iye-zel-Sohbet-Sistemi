/**
 * The chat history query fetches rows newest-first so its limit retains the
 * latest messages. Reverse a copy before rendering to show them chronologically.
 */
export function chronologicalMessagesFromNewestFirst<T>(
  messages: readonly T[] | null | undefined
): T[] {
  return [...(messages ?? [])].reverse()
}
