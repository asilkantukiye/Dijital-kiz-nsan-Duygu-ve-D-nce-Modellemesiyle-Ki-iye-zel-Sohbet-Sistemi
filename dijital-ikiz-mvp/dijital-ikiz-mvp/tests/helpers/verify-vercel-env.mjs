import { pathToFileURL } from 'node:url'

export const REQUIRED_PRODUCTION_ENVIRONMENT_VARIABLES = Object.freeze([
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'HF_TOKEN'
])

function normalizeEnvList(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.envs)) return parsed.envs
  if (Array.isArray(parsed?.result?.envs)) return parsed.result.envs
  throw new TypeError('Unsupported Vercel environment-variable list format.')
}

function appliesToProduction(item) {
  const target = item?.target ?? item?.targets
  if (target === undefined || target === null) return false
  const values = Array.isArray(target) ? target : [target]
  return values.some((value) => String(value).toLowerCase() === 'production')
}

export function findMissingProductionEnvVariables(value) {
  const envs = normalizeEnvList(value)
  const keys = new Set(
    envs
      .filter(appliesToProduction)
      .map((item) => item?.key ?? item?.name)
      .filter((key) => typeof key === 'string')
  )

  return REQUIRED_PRODUCTION_ENVIRONMENT_VARIABLES.filter((key) => !keys.has(key))
}

async function main() {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', () => {
    let missing
    try {
      missing = findMissingProductionEnvVariables(input)
    } catch {
      console.error('Production environment inspection failed; deployment is blocked.')
      process.exitCode = 1
      return
    }

    if (missing.length > 0) {
      console.error(
        'Deployment blocked. Missing required production environment variable names: ' +
          missing.join(', ')
      )
      process.exitCode = 1
      return
    }

    console.log('Required production environment variable names are present.')
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
