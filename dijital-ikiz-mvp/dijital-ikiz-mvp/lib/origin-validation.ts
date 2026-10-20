/**
 * Validate the request origin for cookie-authenticated state-changing APIs.
 * Browser requests without an Origin header must still provide same-origin
 * Fetch Metadata or a same-origin Referer. Origin-less requests with no
 * trustworthy browser context are rejected to avoid weakening CSRF protection.
 */
export function isAllowedOrigin(request: Request): boolean {
  let requestOrigin: string

  try {
    requestOrigin = new URL(request.url).origin
  } catch {
    return false
  }

  const origin = request.headers.get('origin')
  if (origin !== null) {
    return isSameOrigin(origin, requestOrigin)
  }

  const referer = request.headers.get('referer')
  if (referer !== null) {
    return isSameOrigin(referer, requestOrigin)
  }

  return request.headers.get('sec-fetch-site') === 'same-origin'
}

function isSameOrigin(value: string, requestOrigin: string): boolean {
  try {
    return new URL(value).origin === requestOrigin
  } catch {
    // Treat malformed Origin/Referer values as untrusted.
    return false
  }
}
