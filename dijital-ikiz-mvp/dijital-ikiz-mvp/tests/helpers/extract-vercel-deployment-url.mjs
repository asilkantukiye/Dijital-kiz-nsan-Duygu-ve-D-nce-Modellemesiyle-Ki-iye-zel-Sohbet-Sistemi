import { pathToFileURL } from 'node:url'

/**
 * Extracts the first immutable-looking Vercel deployment hostname from the
 * human-readable CLI output. CLI status messages may surround the URL.
 * Only HTTPS URLs on the exact vercel.app suffix and without a path/query are
 * accepted. This does not authenticate the deployment; the caller verifies it
 * separately using `vercel curl --deployment`.
 */
export function extractVercelDeploymentUrl(output) {
  if (typeof output !== 'string' || output.trim() === '') {
    throw new Error('Vercel CLI output was empty.')
  }

  const cleanOutput = output.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
  const candidates = cleanOutput.match(/https:\/\/[^\s"'<>]+/g) ?? []

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.replace(/[),;\]}]+$/g, '').replace(/[.,]+$/g, '')

    let url
    try {
      url = new URL(candidate)
    } catch {
      continue
    }

    if (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.vercel.app') &&
      !url.username &&
      !url.password &&
      (url.pathname === '/' || url.pathname === '') &&
      !url.search &&
      !url.hash
    ) {
      return url.origin
    }
  }

  throw new Error('Vercel CLI output did not contain a valid HTTPS deployment URL.')
}

async function main() {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
  }

  try {
    process.stdout.write(extractVercelDeploymentUrl(input) + '\n')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not parse deployment URL.'
    console.error(message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
