import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const pagePath = path.resolve(testDirectory, '../app/page.tsx')

async function loadPage() {
  return readFile(pagePath, 'utf8')
}

test('anonymous session failure releases the loading screen and shows a safe error', async () => {
  const source = await loadPage()
  assert.match(source, /supabase\.auth\.getSession\(\)[\s\S]*?signInAnonymously\(\)/)
  assert.ok(source.includes('Anonim oturum açılamadı'))
  assert.match(source, /setLoadingSession\(false\)/)
  assert.match(source, /\{error && <p className="small" role="alert">\{error\}<\/p>\}/)
})

test('saved-data lookup catches thrown network errors and always clears its loading flag', async () => {
  const source = await loadPage()

  assert.match(source, /async function loadData\(\)\s*\{[\s\S]*?try\s*\{[\s\S]*?Promise\.all\([\s\S]*?catch\s*\{[\s\S]*?Kayıtlı veriler yüklenemedi[\s\S]*?finally\s*\{\s*if \(mounted\) setLoadingData\(false\)/)
})

test('chat failure removes only its own optimistic user message', async () => {
  const source = await loadPage()

  assert.match(source, /const optimisticUserMessage: Message =/)
  assert.match(source, /setMessages\(\(current\) => current\.filter\(\(item\) => item !== optimisticUserMessage\)\)/)
  assert.doesNotMatch(source, /setMessages\(\(current\) => current\.slice\(0, -1\)\)/)
})

test('variant switching and destructive toolbar actions are disabled during requests/data loading', async () => {
  const source = await loadPage()

  assert.match(source, /disabled=\{loading \|\| loadingData\}[\s\S]*?setVariant\(variant === 'personalized'/)
  assert.match(source, /disabled=\{loading \|\| loadingData\} onClick=\{clearData\}/)
  assert.match(source, /disabled=\{loading \|\| loadingData\}\s+onChange=\{\(event\) => setText/)
  assert.match(source, /disabled=\{loading \|\| loadingData \|\| !text\.trim\(\)\} onClick=\{send\}/)
})
