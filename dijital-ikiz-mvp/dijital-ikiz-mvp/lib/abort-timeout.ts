export async function withAbortTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('timeoutMs must be a positive safe integer.')
  }

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    return await operation(controller.signal)
  } catch (error: unknown) {
    if (timedOut) {
      throw new Error(timeoutMessage)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
