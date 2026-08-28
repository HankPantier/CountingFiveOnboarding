'use client'

import { useState } from 'react'
import type {
  PricingPlansConfig,
  PlanTier,
  PlanFeature,
  PlanAddOn,
} from '@/types/pricing-plans'

// --- local helpers ---------------------------------------------------------

function slugify(input: string, fallback: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || fallback
}

// De-duplicate ids across a list.
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

export default function PricingPlansEditor({
  sessionId,
  initialConfig,
  initialEnabled,
  published = false,
}: {
  sessionId: string
  initialConfig: PricingPlansConfig
  initialEnabled: boolean
  published?: boolean
}) {
  const [config, setConfig] = useState<PricingPlansConfig>(initialConfig)
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function patch(update: Partial<PricingPlansConfig>) {
    setConfig(prev => ({ ...prev, ...update }))
  }

  // --- tiers ---
  function updateTier(i: number, patchTier: Partial<PlanTier>) {
    patch({ tiers: config.tiers.map((t, idx) => (idx === i ? { ...t, ...patchTier } : t)) })
  }
  function addTier() {
    patch({
      tiers: [
        ...config.tiers,
        { id: '', name: '', monthlyPrice: 0, annualPrice: 0, priceSuffix: '/mo', isMostPopular: false, features: [], cta: { label: 'Get started', url: '/contact' } },
      ],
    })
  }
  function removeTier(i: number) {
    patch({ tiers: config.tiers.filter((_, idx) => idx !== i) })
  }
  // Exclusive: flagging one tier most-popular clears the others.
  function setMostPopular(i: number) {
    patch({ tiers: config.tiers.map((t, idx) => ({ ...t, isMostPopular: idx === i })) })
  }

  // --- tier features ---
  function updateFeature(ti: number, fi: number, patchFeat: Partial<PlanFeature>) {
    const tier = config.tiers[ti]
    updateTier(ti, { features: tier.features.map((f, idx) => (idx === fi ? { ...f, ...patchFeat } : f)) })
  }
  function addFeature(ti: number) {
    const tier = config.tiers[ti]
    updateTier(ti, { features: [...tier.features, { id: '', label: '', included: true }] })
  }
  function removeFeature(ti: number, fi: number) {
    const tier = config.tiers[ti]
    updateTier(ti, { features: tier.features.filter((_, idx) => idx !== fi) })
  }

  // --- shared features ---
  function updateSharedItem(i: number, value: string) {
    patch({ sharedFeatures: { ...config.sharedFeatures, items: config.sharedFeatures.items.map((it, idx) => (idx === i ? value : it)) } })
  }
  function addSharedItem() {
    patch({ sharedFeatures: { ...config.sharedFeatures, items: [...config.sharedFeatures.items, ''] } })
  }
  function removeSharedItem(i: number) {
    patch({ sharedFeatures: { ...config.sharedFeatures, items: config.sharedFeatures.items.filter((_, idx) => idx !== i) } })
  }

  // --- add-ons ---
  function updateAddOn(i: number, next: PlanAddOn) {
    patch({ addOns: config.addOns.map((a, idx) => (idx === i ? next : a)) })
  }
  function addAddOn() {
    patch({ addOns: [...config.addOns, { id: '', label: '', type: 'flat', price: 0, cadence: 'month' }] })
  }
  function removeAddOn(i: number) {
    patch({ addOns: config.addOns.filter((_, idx) => idx !== i) })
  }

  // Normalize ids from labels + enforce a single most-popular before persisting.
  function toConfig(): PricingPlansConfig {
    let seenPopular = false
    const tiers = withUniqueIds(
      config.tiers.map((t, i) => {
        const popular = t.isMostPopular && !seenPopular
        if (popular) seenPopular = true
        const tier: PlanTier = {
          id: slugify(t.name, `tier-${i + 1}`),
          name: t.name,
          monthlyPrice: Number(t.monthlyPrice) || 0,
          annualPrice: Number(t.annualPrice) || 0,
          isMostPopular: popular,
          features: withUniqueIds(
            t.features
              .filter(f => f.label.trim())
              .map((f, fi) => ({ id: slugify(f.label, `feat-${fi + 1}`), label: f.label, included: f.included }))
          ),
          cta: { label: t.cta.label || 'Get started', url: t.cta.url || '/contact' },
        }
        if (t.description) tier.description = t.description
        if (t.priceSuffix) tier.priceSuffix = t.priceSuffix
        return tier
      })
    )
    return {
      ...config,
      tiers,
      sharedFeatures: { ...config.sharedFeatures, items: config.sharedFeatures.items.filter(it => it.trim()) },
      addOns: withUniqueIds(config.addOns.filter(a => a.label.trim()).map((a, i) => ({ ...a, id: slugify(a.label, `addon-${i + 1}`) }))),
    }
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/pricing-plans/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: toConfig(), enabled }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Save failed')
      setConfig(data.config as PricingPlansConfig)
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
      const res = await fetch(`/api/pricing-plans/${sessionId}/seed`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'Draft failed')
      setConfig(data.config as PricingPlansConfig)
      setMessage({ kind: 'ok', text: 'Drafted from the firm profile — review and Save.' })
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Draft failed' })
    } finally {
      setSeeding(false)
    }
  }

  const b = config.billing

  return (
    <div className="space-y-6">
      {published && (
        <div className="rounded-xl border border-info/30 bg-info/5 px-4 py-3 text-xs font-body text-text-secondary">
          This client is live. Saving pushes the plans page to the site&rsquo;s <span className="font-semibold">draft</span> branch —
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
          Publish the plans page to this client&rsquo;s site
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

      {/* Intro + billing */}
      <div className={cardCls}>
        <SectionHeader title="Intro & billing" />
        <div>
          <label className={labelCls}>Intro text</label>
          <textarea rows={2} value={config.intro} onChange={e => patch({ intro: e.target.value })} className={inputCls} />
        </div>
        <label className="flex items-center gap-2 text-xs font-body text-text-secondary">
          <input
            type="checkbox"
            checked={b.showToggle}
            onChange={e => patch({ billing: { ...b, showToggle: e.target.checked } })}
            className="h-4 w-4 accent-brand-cyan"
          />
          Show a monthly / annual billing toggle
        </label>
        {b.showToggle && (
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Default</label>
              <select value={b.defaultCadence} onChange={e => patch({ billing: { ...b, defaultCadence: e.target.value as 'monthly' | 'annual' } })} className={inputCls}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Annual save %</label>
              <input type="number" min={0} max={90} value={b.annualDiscountPct} onChange={e => patch({ billing: { ...b, annualDiscountPct: Number(e.target.value) } })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Monthly label</label>
              <input value={b.monthlyLabel} onChange={e => patch({ billing: { ...b, monthlyLabel: e.target.value } })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Annual label</label>
              <input value={b.annualLabel} onChange={e => patch({ billing: { ...b, annualLabel: e.target.value } })} className={inputCls} />
            </div>
          </div>
        )}
      </div>

      {/* Tiers */}
      <div className={cardCls}>
        <div className="flex items-center justify-between">
          <SectionHeader title="Plan tiers" hint="Prices are per-month; annual is the discounted per-month figure. Flag one tier as most popular." />
          <button onClick={addTier} className={secondaryBtn}>+ Add tier</button>
        </div>
        {config.tiers.map((tier, ti) => (
          <div key={ti} className="rounded-lg border border-border-default bg-surface-subtle p-3 space-y-3">
            <div className="grid grid-cols-12 gap-2 items-start">
              <div className="col-span-4">
                <label className={labelCls}>Name</label>
                <input value={tier.name} onChange={e => updateTier(ti, { name: e.target.value })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>$/mo</label>
                <input type="number" min={0} value={tier.monthlyPrice} onChange={e => updateTier(ti, { monthlyPrice: Number(e.target.value) })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>$/mo annual</label>
                <input type="number" min={0} value={tier.annualPrice} onChange={e => updateTier(ti, { annualPrice: Number(e.target.value) })} className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Suffix</label>
                <input value={tier.priceSuffix ?? ''} onChange={e => updateTier(ti, { priceSuffix: e.target.value })} placeholder="/mo or Custom" className={inputCls} />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-[11px] font-body text-text-muted flex items-center gap-1 mt-5">
                  <input type="radio" name="mostPopular" checked={tier.isMostPopular} onChange={() => setMostPopular(ti)} className="h-3.5 w-3.5 accent-brand-cyan" />
                  Most popular
                </label>
                <button onClick={() => removeTier(ti)} className={removeBtn}>Remove tier</button>
              </div>
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input value={tier.description ?? ''} onChange={e => updateTier(ti, { description: e.target.value })} className={inputCls} />
            </div>

            {/* Features */}
            <div className="rounded-lg border border-border-default bg-surface-default p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-heading font-semibold text-text-secondary">
                  Features <span className="font-body font-normal text-text-muted">— uncheck to show as not included</span>
                </span>
                <button onClick={() => addFeature(ti)} className={secondaryBtn}>+ Add feature</button>
              </div>
              {tier.features.map((f, fi) => (
                <div key={fi} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-9">
                    <input value={f.label} onChange={e => updateFeature(ti, fi, { label: e.target.value })} placeholder="Feature (e.g. Monthly bookkeeping)" className={inputCls} />
                  </div>
                  <label className="col-span-2 text-[11px] font-body text-text-muted flex items-center gap-1">
                    <input type="checkbox" checked={f.included} onChange={e => updateFeature(ti, fi, { included: e.target.checked })} className="h-3.5 w-3.5 accent-brand-cyan" />
                    Included
                  </label>
                  <div className="col-span-1 flex justify-end">
                    <button onClick={() => removeFeature(ti, fi)} className={removeBtn} aria-label="Remove feature">×</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Tier CTA */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>CTA label</label>
                <input value={tier.cta.label} onChange={e => updateTier(ti, { cta: { ...tier.cta, label: e.target.value } })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>CTA link</label>
                <input value={tier.cta.url} onChange={e => updateTier(ti, { cta: { ...tier.cta, url: e.target.value } })} className={inputCls} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Shared features */}
      <div className={cardCls}>
        <div className="flex items-center justify-between">
          <SectionHeader title="All plans include" hint="Shared benefits listed below the cards." />
          <button onClick={addSharedItem} className={secondaryBtn}>+ Add item</button>
        </div>
        <div>
          <label className={labelCls}>Heading</label>
          <input value={config.sharedFeatures.heading} onChange={e => patch({ sharedFeatures: { ...config.sharedFeatures, heading: e.target.value } })} className={inputCls} />
        </div>
        {config.sharedFeatures.items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <div className="col-span-11">
              <input value={it} onChange={e => updateSharedItem(i, e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-1 flex justify-end">
              <button onClick={() => removeSharedItem(i)} className={removeBtn} aria-label="Remove item">×</button>
            </div>
          </div>
        ))}
      </div>

      {/* Add-ons */}
      <div className={cardCls}>
        <div className="flex items-center justify-between">
          <SectionHeader title="Add-ons" hint="Optional extras shown below the tiers." />
          <button onClick={addAddOn} className={secondaryBtn}>+ Add add-on</button>
        </div>
        {config.addOns.map((a, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end">
            <div className="col-span-4">
              <label className={labelCls}>Label</label>
              <input value={a.label} onChange={e => updateAddOn(i, { ...a, label: e.target.value })} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Type</label>
              <select
                value={a.type}
                onChange={e =>
                  updateAddOn(i, e.target.value === 'per-unit'
                    ? { id: a.id, label: a.label, type: 'per-unit', unitPrice: 0, unitLabel: 'unit' }
                    : { id: a.id, label: a.label, type: 'flat', price: 0, cadence: 'month' })
                }
                className={inputCls}
              >
                <option value="flat">Flat</option>
                <option value="per-unit">Per unit</option>
              </select>
            </div>
            {a.type === 'flat' ? (
              <>
                <div className="col-span-2">
                  <label className={labelCls}>Price $</label>
                  <input type="number" min={0} value={a.price} onChange={e => updateAddOn(i, { ...a, price: Number(e.target.value) })} className={inputCls} />
                </div>
                <div className="col-span-3">
                  <label className={labelCls}>Cadence</label>
                  <select value={a.cadence} onChange={e => updateAddOn(i, { ...a, cadence: e.target.value as 'month' | 'year' | 'once' })} className={inputCls}>
                    <option value="month">Per month</option>
                    <option value="year">Per year</option>
                    <option value="once">One-time</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="col-span-2">
                  <label className={labelCls}>$/unit</label>
                  <input type="number" min={0} value={a.unitPrice} onChange={e => updateAddOn(i, { ...a, unitPrice: Number(e.target.value) })} className={inputCls} />
                </div>
                <div className="col-span-3">
                  <label className={labelCls}>Unit label</label>
                  <input value={a.unitLabel} onChange={e => updateAddOn(i, { ...a, unitLabel: e.target.value })} className={inputCls} />
                </div>
              </>
            )}
            <div className="col-span-1">
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
