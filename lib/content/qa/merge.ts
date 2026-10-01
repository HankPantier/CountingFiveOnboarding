// Folds QA findings into the page. Only `auto` findings change anything; every
// failure degrades to a human flag instead of a wrong edit. Pure.
import { applyBatchEdits, checkEditAnnotations } from '@/lib/editor/apply-edit'
import { setSectionVariant } from '@/lib/editor/section-layout'
import type { Finding } from '@/types/qa-review'

export type PageFields = { body: string; metaTitle: string | null; metaDescription: string | null }

const toFlag = (f: Finding, why: string): Finding => ({ ...f, safety: 'flag', status: 'open', message: `${f.message} ${why}`.trim() })

function overlapsProtected(find: string, protectedTexts: string[]): boolean {
  return protectedTexts.some(p => p && (p.includes(find) || find.includes(p)))
}

function patchField(current: string | null, find: string, replace: string): string | null {
  const cur = current ?? ''
  if (find === cur) return replace
  const first = cur.indexOf(find)
  if (!find || first < 0 || cur.indexOf(find, first + 1) >= 0) return null
  return cur.slice(0, first) + replace + cur.slice(first + find.length)
}

export function mergeFindings(
  fields: PageFields,
  findings: Finding[],
  opts: { apply: boolean; protectedTexts: string[]; templateVersion?: string | null },
): { fields: PageFields; findings: Finding[] } {
  if (!opts.apply) return { fields, findings: findings.map(f => ({ ...f, status: f.status === 'applied' ? 'open' : f.status })) }

  let { body, metaTitle, metaDescription } = fields
  const out = new Map<string, Finding>(findings.map(f => [f.id, f]))

  // 1. Variant fixes (rules) — index-based, so run before text patches move anything.
  for (const f of findings) {
    if (f.safety !== 'auto' || !f.variantFix) continue
    const r = setSectionVariant(body, f.variantFix.sectionIndex, f.variantFix.variant, { templateVersion: opts.templateVersion })
    if (r.ok) { body = r.body; out.set(f.id, { ...f, status: 'applied' }) }
    else out.set(f.id, toFlag(f, `(${r.reason})`))
  }

  // 2. Meta patches.
  for (const f of findings) {
    if (f.safety !== 'auto' || !f.patch || f.patch.target === 'body') continue
    if (f.patch.target === 'meta_title') {
      const next = patchField(metaTitle, f.patch.find, f.patch.replace)
      if (next === null) out.set(f.id, toFlag(f, '(could not locate the text to change)'))
      else { metaTitle = next; out.set(f.id, { ...f, status: 'applied' }) }
    } else {
      const next = patchField(metaDescription, f.patch.find, f.patch.replace)
      if (next === null) out.set(f.id, toFlag(f, '(could not locate the text to change)'))
      else { metaDescription = next; out.set(f.id, { ...f, status: 'applied' }) }
    }
  }

  // 3. Body patches — one batch, annotation-checked as a unit.
  const bodyFindings = findings.filter(f => f.safety === 'auto' && f.patch?.target === 'body')
  const allowed: Finding[] = []
  for (const f of bodyFindings) {
    if (overlapsProtected(f.patch!.find, opts.protectedTexts)) out.set(f.id, toFlag(f, '(touches protected verbatim text)'))
    else allowed.push(f)
  }
  if (allowed.length) {
    const before = body
    const res = applyBatchEdits(before, allowed.map(f => ({ find: f.patch!.find, replace: f.patch!.replace })))
    const failedFinds = new Set([...res.failed, ...res.unchanged].map(x => x.find))
    const check = checkEditAnnotations(before, res.next, { templateVersion: opts.templateVersion })
    if (check.errors.length) {
      for (const f of allowed) out.set(f.id, toFlag(f, '(would break a section annotation)'))
    } else {
      body = res.next
      for (const f of allowed) {
        out.set(f.id, failedFinds.has(f.patch!.find) ? toFlag(f, '(could not locate the text to change)') : { ...f, status: 'applied' })
      }
    }
  }

  // 4. auto findings with nothing to apply become flags.
  for (const f of findings) {
    if (f.safety === 'auto' && !f.patch && !f.variantFix) out.set(f.id, toFlag(f, ''))
  }

  return { fields: { body, metaTitle, metaDescription }, findings: findings.map(f => out.get(f.id)!) }
}
