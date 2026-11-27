import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/** The eight DSH languages plus Italian. */
const LOCALES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'it']

/**
 * @param id - locale id.
 * @returns the parsed package metadata file.
 */
function readLocale(id) {
  return JSON.parse(readFileSync(new URL(`../locale/${id}.json`, import.meta.url), 'utf8'))
}

test('plugin display metadata is localized in every DSH language plus Italian', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json', 'the locale files are exported')
  for (const id of LOCALES) {
    assert.ok(manifest.files.includes(`locale/${id}.json`), `locale/${id}.json is packed`)
  }

  const titles = new Set()
  const descriptions = new Set()
  for (const id of LOCALES) {
    const meta = readLocale(id).meta
    assert.equal(typeof meta?.title, 'string', `${id} title is a string`)
    assert.ok(meta.title.trim().length > 0, `${id} title is not empty`)
    assert.equal(typeof meta?.description, 'string', `${id} description is a string`)
    assert.ok(meta.description.trim().length > 0, `${id} description is not empty`)
    titles.add(meta.title)
    descriptions.add(meta.description)
  }
  assert.ok(titles.size >= 8, `titles are localized, not copied: ${[...titles].join(' | ')}`)
  assert.ok(descriptions.size >= 8, 'descriptions are localized, not copied')
})

test('the English fallback names the package and Italian carries its own copy', () => {
  assert.equal(readLocale('en').meta.title, 'Additions')
  assert.equal(readLocale('it').meta.title, 'Aggiunte')
  assert.match(readLocale('it').meta.description, /workspace/u)
})
