import { createHash, randomInt } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  analyzeMessage,
  profileToSystemPrompt,
} from '../lib/twin.ts'
import { resolveChatCompletionsUrl } from '../lib/huggingface.ts'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const datasetPath = resolve(projectRoot, 'ml/evaluation/style-ab-cases.json')
const defaultOutputRoot = resolve(projectRoot, 'ml/private/style-ab-runs')

const commonSystemPrompt = [
  'Sen Türkçe yanıt üreten bir araştırma prototipisin.',
  'Kullanıcının sorusunu doğru, açık ve güvenli biçimde yanıtla.',
  'Kişinin kimliğini taklit ettiğini veya onun adına gerçek dünyada işlem yaptığını iddia etme.',
  'Psikolojik tanı koyma ve doğrulanmamış kişilik çıkarımları yapma.',
].join('\n\n')

export function buildProfile(examples) {
  if (!Array.isArray(examples) || examples.length < 2 ||
      examples.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('Her deney profili için en az iki metin örneği gerekir.')
  }

  return examples.reduce(
    (profile, sample) => analyzeMessage(sample, profile),
    null
  )
}

export function buildSystemPrompt(profile = null) {
  if (!profile) {
    return [
      commonSystemPrompt,
      'Bu genel yanıt koşuludur. Kullanıcıya ait üslup profili verilmemiştir.',
      'Kullanıcı mesajına doğal ve tarafsız bir Türkçe yanıt üret.',
    ].join('\n\n')
  }

  return [
    commonSystemPrompt,
    profileToSystemPrompt(profile),
  ].join('\n\n')
}

export function createBlindPair(caseId, baseline, personalized, firstCondition) {
  if (!caseId || typeof baseline !== 'string' || !baseline.trim() ||
      typeof personalized !== 'string' || !personalized.trim()) {
    throw new Error('Kör yanıt çifti için kimlik ve iki boş olmayan yanıt gerekir.')
  }
  if (!['baseline', 'personalized'].includes(firstCondition)) {
    throw new Error('İlk yanıt koşulu geçersiz.')
  }

  const first = firstCondition === 'baseline' ? baseline : personalized
  const second = firstCondition === 'baseline' ? personalized : baseline

  return {
    blind: {
      case_id: caseId,
      response_1: first,
      response_2: second,
    },
    key: {
      case_id: caseId,
      response_1_condition: firstCondition,
      response_2_condition: firstCondition === 'baseline' ? 'personalized' : 'baseline',
    },
  }
}

function parseLimit(argv) {
  const index = argv.indexOf('--limit')
  if (index === -1) return null
  const value = Number(argv[index + 1])
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('--limit pozitif bir tam sayı olmalıdır.')
  }
  return value
}

async function requestCompletion({ endpoint, token, model, messages, timeoutMs }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      top_p: 0.8,
      max_tokens: 300,
      seed: 42,
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Inference isteği başarısız: HTTP ' + response.status + '. Yanıt gövdesi güvenlik için gösterilmedi.')
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Inference servisi boş veya beklenmeyen biçimde yanıt verdi.')
  }
  return content.trim()
}

async function main() {
  const token = process.env.HF_TOKEN?.trim()
  const configuredUrl = process.env.HF_CHAT_COMPLETIONS_URL?.trim()
  const endpoint = resolveChatCompletionsUrl(configuredUrl)
  const model = process.env.HF_MODEL?.trim()
  const timeoutMs = Number(process.env.HF_STYLE_AB_TIMEOUT_MS ?? 120000)
  const limit = parseLimit(process.argv.slice(2))

  if (!token || !endpoint || !configuredUrl || !model) {
    throw new Error('HF_TOKEN, HF_MODEL ve HF_CHAT_COMPLETIONS_URL tanımlanmalıdır.')
  }
  if (!new URL(endpoint).hostname.endsWith('.endpoints.huggingface.cloud')) {
    throw new Error('Araştırma koşusu yalnızca ayrılmış Hugging Face Inference Endpoint üzerinde çalıştırılır.')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 600000) {
    throw new Error('HF_STYLE_AB_TIMEOUT_MS 10000–600000 aralığında tam sayı olmalıdır.')
  }

  const datasetText = await readFile(datasetPath, 'utf8')
  const dataset = JSON.parse(datasetText)
  if (!dataset || !dataset.profiles || !Array.isArray(dataset.cases) || dataset.cases.length < 30) {
    throw new Error('Deney dosyası en az 30 test girdisi ve profil tanımları içermelidir.')
  }

  const selectedCases = limit ? dataset.cases.slice(0, limit) : dataset.cases
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const outputDir = resolve(defaultOutputRoot, runId)
  await mkdir(outputDir, { recursive: true })

  const blindRows = []
  const keyRows = []
  const common = { endpoint, token, model, timeoutMs }

  for (let index = 0; index < selectedCases.length; index += 1) {
    const testCase = selectedCases[index]
    const profileDefinition = dataset.profiles[testCase.profile_id]
    if (!profileDefinition || !Array.isArray(profileDefinition.examples) ||
        typeof testCase.prompt !== 'string' || !testCase.prompt.trim()) {
      throw new Error('Deney girdisi ' + (testCase.id ?? index) + ' geçersiz.')
    }

    const profile = buildProfile(profileDefinition.examples)
    const baselineMessages = [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: testCase.prompt },
    ]
    const personalizedMessages = [
      { role: 'system', content: buildSystemPrompt(profile) },
      { role: 'user', content: testCase.prompt },
    ]

    const baseline = await requestCompletion({ ...common, messages: baselineMessages })
    const personalized = await requestCompletion({ ...common, messages: personalizedMessages })
    const firstCondition = randomInt(2) === 0 ? 'baseline' : 'personalized'
    const pair = createBlindPair(testCase.id, baseline, personalized, firstCondition)

    blindRows.push({
      ...pair.blind,
      prompt: testCase.prompt,
      profile_id: testCase.profile_id,
    })
    keyRows.push(pair.key)
    process.stdout.write('Tamamlandı: ' + (index + 1) + '/' + selectedCases.length + '\n')
  }

  const blindPath = resolve(outputDir, 'blind-evaluation.jsonl')
  const keyPath = resolve(outputDir, 'condition-key.json')
  const manifestPath = resolve(outputDir, 'run-manifest.json')
  await writeFile(blindPath, blindRows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
  await writeFile(keyPath, JSON.stringify(keyRows, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  await writeFile(manifestPath, JSON.stringify({
    created_at: new Date().toISOString(),
    model_alias: model,
    endpoint_host: new URL(endpoint).hostname,
    dataset_sha256: createHash('sha256').update(datasetText).digest('hex'),
    cases_completed: blindRows.length,
    parameters: { temperature: 0.2, top_p: 0.8, max_tokens: 300, seed: 42 },
    note: 'Synthetic pilot. The condition key must remain separate until blind scoring is complete.',
  }, null, 2) + '\n', 'utf8')

  process.stdout.write('Kör tamamlandı. Kör yanıt paketi: ' + blindPath + '\n')
  process.stdout.write('Koşul anahtarı (puanlama bitene kadar gizli): ' + keyPath + '\n')
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const isDirectExecution = invokedPath === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  main().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : 'Deney çalıştırılamadı.') + '\n')
    process.exitCode = 1
  })
}
