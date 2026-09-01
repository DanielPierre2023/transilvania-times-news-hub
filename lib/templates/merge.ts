// lib/templates/merge.ts
//
// Merge fields: `{{prenume}}` in a script, one value per row, one film per row.
//
// This is the smallest piece of the bulk feature and the one that decides
// whether it can be trusted, because every failure mode is silent:
//
//   A MISSPELLED FIELD RENDERS AS ITSELF. `{{prenmue}}` with no matching column
//   produces a film that says "Bună, {{prenmue}}" and it is sent to a customer.
//   Substitution therefore REPORTS what it could not resolve, and the campaign
//   refuses to start while anything is unresolved.
//
//   AN EMPTY CELL IS NOT A MISSING FIELD. A row with no company name is a real
//   row that needs a fallback ("echipa ta"), not an error. Blank and absent are
//   different states and are kept different.
//
//   A LONG VALUE BREAKS THE LAYOUT. "Ana" and
//   "Întreprinderea Individuală de Construcții Metalice" both go in the same
//   lower third. The length of every substituted value is measured against the
//   slot's budget BEFORE the campaign runs, so it fails on the spreadsheet
//   rather than in shot three of film 214.

export interface MergeField {
  readonly key: string
  readonly label: string
  /** Used when a row has the column but the cell is empty. */
  readonly fallback?: string
  /** Longest value the slot can hold before the layout suffers. */
  readonly maxChars?: number
  /**
   * Tidy the value on the way in.
   *
   * Spreadsheets arrive shouting. A column exported from a CRM is as likely to
   * hold "ANA-MARIA POP" as "Ana-Maria Pop", and a film that opens "Bună, ANA"
   * is worse than no personalisation at all. This is DECLARED per field rather
   * than applied to everything, because tidying is only ever right for names —
   * doing it to a product code or a slogan would corrupt real data.
   */
  readonly transform?: 'name' | 'firstName'
}

export interface MergeIssue {
  readonly row: number
  readonly key: string
  readonly kind: 'unknown' | 'empty' | 'tooLong'
  readonly message: string
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g

/** Every field name a piece of text asks for, in order, deduplicated. */
export function fieldsUsed(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(TOKEN)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Every field used anywhere in a template's texts. */
export function fieldsUsedIn(texts: readonly string[]): string[] {
  const out: string[] = []
  for (const t of texts) for (const f of fieldsUsed(t)) if (!out.includes(f)) out.push(f)
  return out
}

/** Titlecase a name that arrived as ANA-MARIA or ana maria, leaving the rest alone. */
export function tidyName(value: string): string {
  const v = value.trim()
  if (!v) return v
  // Only intervene when the value is clearly all one case; a deliberately
  // styled name like "van der Berg" or "IKEA" must survive untouched.
  const isAllUpper = v === v.toUpperCase() && /[A-ZĂÂÎȘȚ]/.test(v)
  const isAllLower = v === v.toLowerCase()
  if (!isAllUpper && !isAllLower) return v
  return v.replace(/[\p{L}][\p{L}'’]*/gu, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

/** First name only, for a greeting. "Ana Maria Pop" → "Ana". */
export const firstName = (value: string): string => tidyName(value).trim().split(/\s+/)[0] || ''

export interface SubstituteResult {
  readonly text: string
  /** Field names that had no column at all. NOT the same as an empty cell. */
  readonly unresolved: readonly string[]
}

/**
 * Replace every `{{field}}` in `text` from `row`.
 *
 * An absent column is left in place AND reported, rather than replaced with an
 * empty string. Silently emptying it produces "Bună, , mă bucur" — grammatical
 * damage that reads as a bug in the copy rather than a missing column, and is
 * therefore looked for in the wrong place.
 */
export function substitute(
  text: string,
  row: Readonly<Record<string, string>>,
  fields: readonly MergeField[] = [],
): SubstituteResult {
  const byKey = new Map(fields.map(f => [f.key, f]))
  const unresolved: string[] = []
  const out = text.replace(TOKEN, (whole, key: string) => {
    if (!(key in row)) {
      if (!unresolved.includes(key)) unresolved.push(key)
      return whole
    }
    const def = byKey.get(key)
    const raw = (row[key] ?? '').trim()
    // A FALLBACK IS AUTHORED TEXT AND IS ALREADY CORRECT. Running the tidy over
    // it turned the fallback "echipa ta" into "Echipa Ta" — a transform meant
    // for shouting CRM exports quietly capitalising a phrase somebody wrote by
    // hand. Transforms apply to spreadsheet values only.
    if (!raw) return def?.fallback ?? ''
    if (def?.transform === 'firstName') return firstName(raw)
    if (def?.transform === 'name') return tidyName(raw)
    return raw
  })
  return { text: out, unresolved }
}

/**
 * Check a whole spreadsheet against a template before spending anything.
 *
 * Returns every problem in every row, not just the first, because fixing a
 * spreadsheet one error per run is how a hundred-row campaign takes an evening.
 */
export function validateRows(
  rows: readonly Readonly<Record<string, string>>[],
  texts: readonly string[],
  fields: readonly MergeField[] = [],
): MergeIssue[] {
  const issues: MergeIssue[] = []
  const needed = fieldsUsedIn(texts)
  const byKey = new Map(fields.map(f => [f.key, f]))

  rows.forEach((row, i) => {
    for (const key of needed) {
      const def = byKey.get(key)
      if (!(key in row)) {
        issues.push({ row: i, key, kind: 'unknown',
          message: `Rândul ${i + 1}: nu există o coloană „${key}”.` })
        continue
      }
      const raw = (row[key] ?? '').trim()
      if (!raw && !def?.fallback) {
        issues.push({ row: i, key, kind: 'empty',
          message: `Rândul ${i + 1}: „${key}” e gol și nu are o valoare de rezervă.` })
        continue
      }
      // Measure what will actually be DRAWN. "ANA-MARIA POP" is 13 characters
      // and "Ana" is 3; checking the raw cell would reject rows that fit fine.
      // The fallback is authored text and is never transformed.
      let value = def?.fallback ?? ''
      if (raw) {
        value = def?.transform === 'firstName' ? firstName(raw)
          : def?.transform === 'name' ? tidyName(raw) : raw
      }
      if (def?.maxChars && value.length > def.maxChars) {
        issues.push({ row: i, key, kind: 'tooLong',
          message: `Rândul ${i + 1}: „${key}” are ${value.length} caractere, ` +
                   `iar locul din cadru ține ${def.maxChars}.` })
      }
    }
  })
  return issues
}

/**
 * Parse pasted spreadsheet text.
 *
 * Tab-separated by default because that is what a paste from Excel, Numbers or
 * Google Sheets actually is. Commas are accepted when no tab is present, with
 * quoted fields honoured — a company name with a comma in it is not two columns,
 * and treating it as two silently shifts every value in the row one place left.
 */
export function parseRows(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const sep = lines[0].includes('\t') ? '\t' : ','

  const split = (line: string): string[] => {
    if (sep === '\t') return line.split('\t').map(c => c.trim())
    const out: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') inQ = false
        else cur += ch
      } else if (ch === '"') inQ = true
      else if (ch === ',') { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }

  const headers = split(lines[0]).map(h => h.replace(/^"|"$/g, '').trim())
  const rows = lines.slice(1).map(line => {
    const cells = split(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { if (h) row[h] = (cells[i] ?? '').replace(/^"|"$/g, '') })
    return row
  })
  return { headers, rows }
}
