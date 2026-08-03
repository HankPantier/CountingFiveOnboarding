'use client'

import { useState } from 'react'
import type {
  PricingCalculatorConfig,
  PricingServiceLine,
  PricingMultiplierOption,
  PricingAddOn,
  ServiceOptionGroup,
  ServiceOptionChoice,
} from '@/types/pricing-calculator'

// --- local helpers ---------------------------------------------------------

function slugify(input: string, fallback: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || fallback
}

// De-duplicate ids across a list (calculator selection state keys on them).
function withUniqueIds<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.map((row, i) => {
    let id = row.id || `item-${i + 1}`
    while (seen.has(id)) id = `${id}-${i + 1}`
    seen.add(id)
    return { ...row, id }
  })
}

const inputCls =
  'w-full rounded-lg border border-border-default bg-surface-default px-3 py-2 font-body text-sm text-text-primary focus:border-brand-cyan focus:outline-none'
const labelCls = 'block text-xs font-heading font-semibold text-text-secondary mb-1'
const cardCls = 'border border-border-default bg-surface-card rounded-xl p-4 space-y-3'
const primaryBtn =
  'bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed'
const secondaryBtn =
  'border border-brand-cyan text-brand-cyan font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-colors hover:bg-brand-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed'
const removeBtn =
  'text-error font-heading font-semibold text-xs px-2 py-1 rounded-pill hover:bg-error/10 transition-colors'

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-sm font-heading font-semibold text-brand-navy">{title}</h2>
      {hint && <p className="text-xs font-body text-text-muted mt-0.5">{hint}</p>}
    </div>
  )
}

// --- component -------------------------------------------------------------

export default function PricingCalculatorEditor({
  sessionId,
  initialConfig,
  initialEnabled,
  published = false,
}: {
  sessionId: string
  initialConfig: PricingCalculatorConfig
  initialEnabled: boolean
  published?: boolean
}) {
  const [config, setConfig] = useState<PricingCalculatorConfig>(initialConfig)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function patch(update: Partial<PricingCalculatorConfig>) {
    setConfig(prev => ({ ...prev, ...update }))
  }

  // --- service lines ---
  function updateLine(i: number, patchLine: Partial<PricingServiceLine>) {
    patch({ serviceLines: config.serviceLines.map((l, idx) => (idx === i ? { ...l, ...patchLine } : l)) })
  }
  function addLine() {
    patch({ serviceLines: [...config.serviceLines, { id: '', label: '', baseRate: 0, enabledByDefault: false }] })
  }
  function removeLine(i: number) {
    patch({ serviceLines: config.serviceLines.filter((_, idx) => idx !== i) })
  }

  // --- per-service option groups ---
  function setLineOptions(i: number, options: ServiceOptionGroup[]) {
    updateLine(i, { options })
  }
  function addOptionGroup(i: number) {
    const groups = config.serviceLines[i].options ?? []
    setLineOptions(i, [...groups, { id: '', label: '', kind: 'select', choices: [{ id: '', label: '', addMonthly: 0 }] }])
  }
  function updateOptionGroup(i: number, gi: number, patchGroup: { label?: string; kind?: 'select' | 'multi' }) {
    const groups = (config.serviceLines[i].options ?? []).map((g, idx) => (idx === gi ? { ...g, ...patchGroup } : g)) as ServiceOptionGroup[]
    setLineOptions(i, groups)
  }
  function removeOptionGroup(i: number, gi: number) {
    setLineOptions(i, (config.serviceLines[i].options ?? []).filter((_, idx) => idx !== gi))
  }
  function addChoice(i: number, gi: number) {
    const groups = (config.serviceLines[i].options ?? []).map((g, idx) =>
      idx === gi ? { ...g, choices: [...g.choices, { id: '', label: '', addMonthly: 0 }] } : g
    ) as ServiceOptionGroup[]
    setLineOptions(i, groups)
  }
  function updateChoice(i: number, gi: number, ci: number, patchChoice: Partial<ServiceOptionChoice>) {
    const groups = (config.serviceLines[i].options ?? []).map((g, idx) =>
      idx === gi ? { ...g, choices: g.choices.map((c, cIdx) => (cIdx === ci ? { ...c, ...patchChoice } : c)) } : g
    ) as ServiceOptionGroup[]
    setLineOptions(i, groups)
  }
  function removeChoice(i: number, gi: number, ci: number) {
    const groups = (config.serviceLines[i].options ?? []).map((g, idx) =>
      idx === gi ? { ...g, choices: g.choices.filter((_, cIdx) => cIdx !== ci) } : g
    ) as ServiceOptionGroup[]
    setLineOptions(i, groups)
  }

  // --- multiplier options (size / complexity) ---
  function updateOpt(key: 'sizeTiers' | 'complexityLevels', i: number, patchOpt: Partial<PricingMultiplierOption>) {
    patch({ [key]: config[key].map((o, idx) => (idx === i ? { ...o, ...patchOpt } : o)) } as Partial<PricingCalculatorConfig>)
  }
  function addOpt(key: 'sizeTiers' | 'complexityLevels') {
    patch({ [key]: [...config[key], { id: '', label: '', multiplier: 1 }] } as Partial<PricingCalculatorConfig>)
  }
  function removeOpt(key: 'sizeTiers' | 'complexityLevels', i: number) {
    patch({ [key]: config[key].filter((_, idx) => idx !== i) } as Partial<PricingCalculatorConfig>)
  }

  // --- add-ons ---
  function updateAddOn(i: number, next: PricingAddOn) {
    patch({ addOns: config.addOns.map((a, idx) => (idx === i ? next : a)) })
  }
  function addAddOn() {
    patch({ addOns: [...config.addOns, { id: '', label: '', type: 'flat', flatRate: 0 }] })
  }
  function removeAddOn(i: number) {
    patch({ addOns: config.addOns.filter((_, idx) => idx !== i) })
  }

  // Clean + id-normalize per-service option groups. Drops blank choices and any
  // group without a label or choices, so a half-filled row never reaches the
  // (strict) server validation and wipes the config.
  function normalizeOptions(groups: ServiceOptionGroup[]): ServiceOptionGroup[] {
    const cleaned = groups
      .map(g => ({ ...g, choices: g.choices.filter(c => c.label.trim()) }))
      .filter(g => g.label.trim() && g.choices.length > 0)
      .map((g, gi) => ({
        ...g,
        id: slugify(g.label, `group-${gi + 1}`),
        choices: withUniqueIds(g.choices.map((c, ci) => ({ ...c, id: slugify(c.label, `choice-${ci + 1}`), addMonthly: Number(c.addMonthly) || 0 }))),
      }))
    return withUniqueIds(cleaned) as ServiceOptionGroup[]
  }

  // Normalize ids from labels before persisting so the emitted JSON is stable.
  function toConfig(): PricingCalculatorConfig {
    return {
      ...config,
      serviceLines: withUniqueIds(
        config.serviceLines.map((l, i) => {
          const line: PricingServiceLine = {
            id: slugify(l.label, `service-${i + 1}`),
            label: l.label,
            baseRate: l.baseRate,
            enabledByDefault: l.enabledByDefault,
          }
          if (l.description) line.description = l.description
          const opts = normalizeOptions(l.options ?? [])
          if (opts.length) line.options = opts
          return line
        })
      ),
      sizeTiers: withUniqueIds(config.sizeTiers.map((o, i) => ({ ...o, id: slugify(o.label, `size-${i + 1}`) }))),
      complexityLevels: withUniqueIds(config.complexityLevels.map((o, i) => ({ ...o, id: slugify(o.label, `level-${i + 1}`) }))),
      addOns: withUniqueIds(config.addOns.map((a, i) => ({ ...a, id: slugify(a.label, `addon-${i + 1}`) }))),
    }
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/pricing-calculator/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: toConfig(), enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      setConfig(data.config as PricingCalculatorConfig)
      if (data.published && data.synced) {
        setMessage({ kind: 'ok', text: 'Saved & pushed to draft — click "Publish to live" in the content editor to deploy.' })
      } else if (data.published && data.syncError) {
        setMessage({ kind: 'err', text: `Saved, but pushing to the site failed: ${data.syncError}` })
      } else {
        setMessage({ kind: 'ok', text: 'Saved.' })
      }
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  async function seed() {
    setSeeding(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/pricing-calculator/${sessionId}/seed`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Draft failed')
      setConfig(data.config as PricingCalculatorConfig)
      setMessage({ kind: 'ok', text: 'Drafted from the firm profile — review and Save.' })
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Draft failed' })
    } finally {
      setSeeding(false)
    }
  }

  const fee = config.implementationFee

  return (
    <div className="space-y-6">
      {published && (
        <div className="rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-xs font-body text-text-secondary">
          This client is live. Saving pushes the calculator to the site&rsquo;s <span className="font-semibold">draft</span> branch —
          then open the content editor and click <span className="font-semibold">Publish to live</span> to deploy it.
        </div>
      )}
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 border border-border-default bg-surface-card rounded-xl p-4">
        <label className="flex items-center gap-2 text-sm font-body text-text-primary">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="h-4 w-4 accent-brand-cyan"
          />
          Publish the calculator to this client&rsquo;s site
        </label>
        <div className="flex items-center gap-2">
          {message && (
            <span className={`text-xs font-body ${message.kind === 'ok' ? 'text-success' : 'text-error'}`}>
              {message.text}
            </span>
          )}
          <button onClick={seed} disabled={seeding || saving} className={secondaryBtn}>
            {seeding ? 'Drafting…' : 'Draft with AI'}
          </button>
          <button onClick={save} disabled={saving} className={primaryBtn}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Copy + fee */}
      <div className={cardCls}>
        <SectionHeader title="Intro & implementation fee" />
        <div>
          <label className={labelCls}>Intro text</label>
          <textarea rows={2} value={config.intro} onChange={e => patch({ intro: e.target.value })} className={inputCls} />
        </div>
        <label className="flex items-center gap-2 text-xs font-body text-text-secondary">
          <input
            type="checkbox"
            checked={fee !== null}
            onChange={e =>
              patch({ implementationFee: e.target.checked ? { amount: 0, label: 'One-time setup', weeks: '4-6' } : null })
            }
            className="h-4 w-4 accent-brand-cyan"
          />
          Charge a one-time implementation fee
        </label>
        {fee && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Amount ($)</label>
              <input type="number" min={0} value={fee.amount} onChange={e => patch({ implementationFee: { ...fee, amount: Number(e.target.value) } })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Label</label>
              <input value={fee.label} onChange={e => patch({ implementationFee: { ...fee, label: e.target.value } })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Timeframe</label>
              <input value={fee.weeks ?? ''} onChange={e => patch({ implementationFee: { ...fee, weeks: e.target.value } })} className={inputCls} />
            </div>
          </div>
        )}
      </div>

      {/* Service lines */}
      <div className={cardCls}>
        <div className="flex items-center justify-between">
          <SectionHeader title="Service lines" hint="Each selected line adds its monthly base rate before multipliers." />
          <button onClick={addLine} className={secondaryBtn}>+ Add line</button>
        </div>
        {config.serviceLines.map((line, i) => (
          <div key={i} className="border-t border-border-default pt-3 first:border-t-0 first:pt-0">
            <div className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-4">
                <label className={labelCls}>Label</label>
                <input value={line.label} onChange={e => updateLine(i, { label: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Base $/mo</label>
                <input type="number" min={0} value={line.baseRate} onChange={e => updateLine(i, { baseRate: Number(e.target.value) })} className={inputCls} />
              </div>
              <div className="col-span-4">
                <label className={labelCls}>Description</label>
                <input value={line.description ?? ''} onChange={e => updateLine(i, { description: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[11px] font-body text-text-muted flex items-center gap-1 mt-5">
                  <input type="checkbox" checked={line.enabledByDefault} onChange={e => updateLine(i, { enabledByDefault: e.target.checked })} className="h-3.5 w-3.5 accent-brand-cyan" />
                  On by default
                </label>
                <button onClick={() => removeLine(i)} className={removeBtn}>Remove</button>
              </div>
            </div>

            {/* Per-service option groups — shown on the site when this service is toggled on */}
            <div className="mt-3 rounded-lg border border-border-default bg-surface-subtle p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-heading font-semibold text-text-secondary">
                  Options <span className="font-body font-normal text-text-muted">— shown when this service is toggled on</span>
                </span>
                <button onClick={() => addOptionGroup(i)} className={secondaryBtn}>+ Option group</button>
              </div>

              {(line.options ?? []).map((g, gi) => (
                <div key={gi} className="rounded-lg border border-border-default bg-surface-default p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-6">
                      <label className={labelCls}>Option group</label>
                      <input value={g.label} onChange={e => updateOptionGroup(i, gi, { label: e.target.value })} placeholder="e.g. Frequency" className={inputCls} />
                    </div>
                    <div className="col-span-4">
                      <label className={labelCls}>Selection</label>
                      <select value={g.kind} onChange={e => updateOptionGroup(i, gi, { kind: e.target.value as 'select' | 'multi' })} className={inputCls}>
                        <option value="select">Single choice</option>
                        <option value="multi">Multiple choice</option>
                      </select>
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <button onClick={() => removeOptionGroup(i, gi)} className={removeBtn}>Remove</button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {g.choices.map((c, ci) => (
                      <div key={ci} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-7">
                          <input value={c.label} onChange={e => updateChoice(i, gi, ci, { label: e.target.value })} placeholder="Choice (e.g. Weekly)" className={inputCls} />
                        </div>
                        <div className="col-span-4 flex items-center gap-1">
                          <span className="text-xs text-text-muted">+$</span>
                          <input type="number" min={0} value={c.addMonthly} onChange={e => updateChoice(i, gi, ci, { addMonthly: Number(e.target.value) })} className={inputCls} />
                          <span className="text-xs text-text-muted whitespace-nowrap">/mo</span>
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button onClick={() => removeChoice(i, gi, ci)} className={removeBtn} aria-label="Remove choice">×</button>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => addChoice(i, gi)} className="text-xs font-heading font-semibold text-brand-cyan hover:underline">+ Add choice</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Size + complexity */}
      {(['sizeTiers', 'complexityLevels'] as const).map(key => (
        <div key={key} className={cardCls}>
          <div className="flex items-center justify-between">
            <SectionHeader
              title={key === 'sizeTiers' ? 'Business size options' : 'Complexity options'}
              hint="The chosen option's multiplier scales the summed service rates."
            />
            <button onClick={() => addOpt(key)} className={secondaryBtn}>+ Add option</button>
          </div>
          {config[key].map((opt, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-7">
                <label className={labelCls}>Label</label>
                <input value={opt.label} onChange={e => updateOpt(key, i, { label: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-3">
                <label className={labelCls}>Multiplier</label>
                <input type="number" min={0} step={0.05} value={opt.multiplier} onChange={e => updateOpt(key, i, { multiplier: Number(e.target.value) })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <button onClick={() => removeOpt(key, i)} className={removeBtn}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* Add-ons */}
      <div className={cardCls}>
        <div className="flex items-center justify-between">
          <SectionHeader title="Add-ons" hint="Applied after multipliers: a flat monthly fee or a per-unit rate × quantity." />
          <button onClick={addAddOn} className={secondaryBtn}>+ Add add-on</button>
        </div>
        {config.addOns.map((a, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4">
              <label className={labelCls}>Label</label>
              <input value={a.label} onChange={e => updateAddOn(i, { ...a, label: e.target.value })} className={inputCls} />
            </div>
            <div className="col-span-3">
              <label className={labelCls}>Type</label>
              <select
                value={a.type}
                onChange={e =>
                  updateAddOn(i, e.target.value === 'per-unit'
                    ? { id: a.id, label: a.label, type: 'per-unit', unitRate: 0, unitLabel: 'unit' }
                    : { id: a.id, label: a.label, type: 'flat', flatRate: 0 })
                }
                className={inputCls}
              >
                <option value="flat">Flat monthly</option>
                <option value="per-unit">Per unit</option>
              </select>
            </div>
            {a.type === 'flat' ? (
              <div className="col-span-3">
                <label className={labelCls}>Flat $/mo</label>
                <input type="number" min={0} value={a.flatRate} onChange={e => updateAddOn(i, { ...a, flatRate: Number(e.target.value) })} className={inputCls} />
              </div>
            ) : (
              <>
                <div className="col-span-2">
                  <label className={labelCls}>$/unit</label>
                  <input type="number" min={0} value={a.unitRate} onChange={e => updateAddOn(i, { ...a, unitRate: Number(e.target.value) })} className={inputCls} />
                </div>
                <div className="col-span-1">
                  <label className={labelCls}>Unit</label>
                  <input value={a.unitLabel} onChange={e => updateAddOn(i, { ...a, unitLabel: e.target.value })} className={inputCls} />
                </div>
              </>
            )}
            <div className="col-span-2">
              <button onClick={() => removeAddOn(i)} className={removeBtn}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      {/* Presentation */}
      <div className={cardCls}>
        <SectionHeader title="Presentation & call to action" />
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Currency</label>
            <input value={config.currency} onChange={e => patch({ currency: e.target.value.toUpperCase().slice(0, 3) })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Billing period</label>
            <select value={config.billingPeriod} onChange={e => patch({ billingPeriod: e.target.value as 'month' | 'year' })} className={inputCls}>
              <option value="month">Per month</option>
              <option value="year">Per year</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Estimate band (±%)</label>
            <input type="number" min={0} max={50} value={config.estimateBandPct} onChange={e => patch({ estimateBandPct: Number(e.target.value) })} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Disclaimer</label>
          <textarea rows={2} value={config.disclaimer} onChange={e => patch({ disclaimer: e.target.value })} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>CTA label</label>
            <input value={config.cta.label} onChange={e => patch({ cta: { ...config.cta, label: e.target.value } })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>CTA link</label>
            <input value={config.cta.url} onChange={e => patch({ cta: { ...config.cta, url: e.target.value } })} className={inputCls} />
          </div>
        </div>
      </div>
    </div>
  )
}
