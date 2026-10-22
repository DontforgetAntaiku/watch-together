import { describe, expect, it } from 'vitest'
import de from '../../i18n/locales/de.json'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'
import fr from '../../i18n/locales/fr.json'
import pl from '../../i18n/locales/pl.json'
import pt from '../../i18n/locales/pt.json'
import ru from '../../i18n/locales/ru.json'
import uk from '../../i18n/locales/uk.json'

type Tree = { [key: string]: string | Tree }
const flat = (tree: Tree, prefix = ''): Record<string, string> =>
  Object.entries(tree).reduce<Record<string, string>>((out, [key, value]) => {
    if (typeof value === 'string') out[prefix + key] = value
    else Object.assign(out, flat(value, `${prefix}${key}.`))
    return out
  }, {})
const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '')
const holes = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',')

const english = flat(en as Tree)
const wanted = new Set(Object.keys(english).map(base))

describe.each([
  ['ru', ru],
  ['uk', uk],
  ['de', de],
  ['es', es],
  ['fr', fr],
  ['pt', pt],
  ['pl', pl],
])('%s translation', (_name, file) => {
  const mine = flat(file as Tree)

  it('has every text of the English one, and nothing extra', () => {
    const have = new Set(Object.keys(mine).map(base))
    expect([...wanted].filter((k) => !have.has(k))).toEqual([])
    expect([...have].filter((k) => !wanted.has(k))).toEqual([])
  })

  it('has a form for every plural (at least "other") and keeps every {{placeholder}}', () => {
    for (const [key, text] of Object.entries(mine)) {
      expect(text.trim(), key).not.toBe('')
      const sameKey = english[key] ?? english[`${base(key)}_other`] ?? english[`${base(key)}_one`]
      expect(holes(text), key).toBe(holes(sameKey))
    }
    for (const key of Object.keys(english).filter((k) => k.endsWith('_other'))) expect(mine[key], key).toBeTruthy()
  })
})
