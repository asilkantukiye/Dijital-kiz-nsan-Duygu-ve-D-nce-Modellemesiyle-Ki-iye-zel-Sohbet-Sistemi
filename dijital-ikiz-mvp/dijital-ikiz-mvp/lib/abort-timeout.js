/**
 * Execute an abort-aware async operation with a timeout covering its full
 * lifecycle. The operation must observe the provided signal (e.g. fetch and
 * response-body reading) so that aborting it causes the promise to settle.
 *
 * @template T
 * @param {number} timeoutMs
 * @param {(signal: AbortSignal) => Promise<T>} operation
 * @param {string} timeoutMessage
 * @returns {Promise<T>}
 */
export async function withAbortTimeout(timeoutMs, operation, timeoutMessage) {
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
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutMessage)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
