'use client'

import { useState } from 'react'
import type {
  PricingCalculatorConfig,
  PricingServiceLine,
  PricingMultiplierOption,
  PricingAddOn,
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
}: {
  sessionId: string
  initialConfig: PricingCalculatorConfig
  initialEnabled: boolean
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

  // Normalize ids from labels before persisting so the emitted JSON is stable.
  function toConfig(): PricingCalculatorConfig {
    return {
      ...config,
      serviceLines: withUniqueIds(config.serviceLines.map((l, i) => ({ ...l, id: slugify(l.label, `service-${i + 1}`) }))),
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
      setMessage({ kind: 'ok', text: 'Saved.' })
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
          <div key={i} className="grid grid-cols-12 gap-2 items-start border-t border-border-default pt-3 first:border-t-0 first:pt-0">
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
