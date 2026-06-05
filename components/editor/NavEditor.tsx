'use client'

import { useMemo, useState } from 'react'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import type { NavJson, NavItem } from '@/types/nav-json'

// Lenient structural parse for the form view: empty labels/urls are allowed
// mid-edit (the strict parser would throw and bounce the user to raw mode on
// every cleared input). Returns null only when the JSON is malformed or the
// shape is unrecognizable — that's when we fall back to the raw textarea.
function lenientParse(text: string): NavJson | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const root = value as Record<string, unknown>
  if (!Array.isArray(root.primary)) return null

  const coerceItem = (raw: unknown): NavItem | null => {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const item: NavItem = {
      label: typeof o.label === 'string' ? o.label : '',
      url: typeof o.url === 'string' ? o.url : '',
    }
    if (Array.isArray(o.children)) {
      const children = o.children
        .map(coerceItem)
        .filter((c): c is NavItem => c !== null)
      if (children.length > 0) item.children = children
    }
    return item
  }

  const primary = root.primary
    .map(coerceItem)
    .filter((c): c is NavItem => c !== null)
  const nav: NavJson = { primary }
  if (root.cta && typeof root.cta === 'object') {
    const cta = root.cta as Record<string, unknown>
    nav.cta = {
      label: typeof cta.label === 'string' ? cta.label : '',
      url: typeof cta.url === 'string' ? cta.url : '',
    }
  }
  return nav
}

function inputClass(empty: boolean): string {
  return `w-full text-xs font-body px-2.5 py-1.5 rounded border bg-surface-card focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-all ${
    empty ? 'border-error/50' : 'border-border-default'
  }`
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-brand-navy hover:bg-surface-subtle disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

function ItemFields({
  item,
  onLabel,
  onUrl,
}: {
  item: NavItem
  onLabel: (v: string) => void
  onUrl: (v: string) => void
}) {
  return (
    <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
      <input
        type="text"
        value={item.label}
        placeholder="Label"
        aria-label="Menu label"
        onChange={(e) => onLabel(e.target.value)}
        className={inputClass(item.label.trim() === '')}
      />
      <input
        type="text"
        value={item.url}
        placeholder="/page-url"
        aria-label="Menu URL"
        onChange={(e) => onUrl(e.target.value)}
        className={`${inputClass(item.url.trim() === '')} font-mono`}
      />
    </div>
  )
}

export default function NavEditor({
  path,
  contents,
  onChange,
}: {
  path: string
  contents: string
  onChange: (next: string) => void
}) {
  const [showRaw, setShowRaw] = useState(false)

  const nav = useMemo(() => lenientParse(contents), [contents])

  // Strict validity drives the badge (and warns about empty fields the
  // lenient form happily tolerates while typing).
  const strictError = useMemo(() => {
    try {
      parseNavJson(contents)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON'
    }
  }, [contents])

  const commit = (next: NavJson) => onChange(serializeNavJson(next))

  const update = (fn: (draft: NavJson) => void) => {
    if (!nav) return
    const draft = structuredClone(nav)
    fn(draft)
    commit(draft)
  }

  const moveInArray = <T,>(arr: T[], from: number, to: number) => {
    if (to < 0 || to >= arr.length) return
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
  }

  const formUnavailable = nav === null

  return (
    <div className="flex-1 overflow-y-auto bg-surface-default">
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div>
          <div className="text-xs font-heading text-text-muted">Editing</div>
          <div className="font-heading font-semibold text-brand-navy text-lg">
            Site navigation
          </div>
        </div>

        {!formUnavailable && (
          <>
            <section className="bg-surface-card border border-border-default rounded-lg">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
                <h2 className="text-sm font-heading font-semibold text-brand-navy">
                  Menu items
                </h2>
                {strictError ? (
                  <span className="text-xs font-body text-error">{strictError}</span>
                ) : (
                  <span className="text-xs font-body text-success">Valid</span>
                )}
              </div>

              <ul className="p-4 space-y-3">
                {nav.primary.length === 0 && (
                  <li className="text-xs font-body text-text-muted">
                    No menu items yet — add one below.
                  </li>
                )}
                {nav.primary.map((item, i) => (
                  <li
                    key={i}
                    className="border border-border-default rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex flex-col">
                        <IconButton
                          label={`Move ${item.label || 'item'} up`}
                          disabled={i === 0}
                          onClick={() => update((d) => moveInArray(d.primary, i, i - 1))}
                        >
                          ▲
                        </IconButton>
                        <IconButton
                          label={`Move ${item.label || 'item'} down`}
                          disabled={i === nav.primary.length - 1}
                          onClick={() => update((d) => moveInArray(d.primary, i, i + 1))}
                        >
                          ▼
                        </IconButton>
                      </div>
                      <ItemFields
                        item={item}
                        onLabel={(v) => update((d) => { d.primary[i].label = v })}
                        onUrl={(v) => update((d) => { d.primary[i].url = v })}
                      />
                      <IconButton
                        label={`Remove ${item.label || 'item'}`}
                        onClick={() => update((d) => { d.primary.splice(i, 1) })}
                      >
                        ✕
                      </IconButton>
                    </div>

                    {(item.children?.length ?? 0) > 0 && (
                      <ul className="ml-8 space-y-2 border-l border-border-default pl-3">
                        {item.children!.map((child, j) => (
                          <li key={j} className="flex items-center gap-2">
                            <div className="flex flex-col">
                              <IconButton
                                label={`Move ${child.label || 'sub-item'} up`}
                                disabled={j === 0}
                                onClick={() =>
                                  update((d) => moveInArray(d.primary[i].children!, j, j - 1))
                                }
                              >
                                ▲
                              </IconButton>
                              <IconButton
                                label={`Move ${child.label || 'sub-item'} down`}
                                disabled={j === item.children!.length - 1}
                                onClick={() =>
                                  update((d) => moveInArray(d.primary[i].children!, j, j + 1))
                                }
                              >
                                ▼
                              </IconButton>
                            </div>
                            <ItemFields
                              item={child}
                              onLabel={(v) =>
                                update((d) => { d.primary[i].children![j].label = v })
                              }
                              onUrl={(v) =>
                                update((d) => { d.primary[i].children![j].url = v })
                              }
                            />
                            <IconButton
                              label={`Remove ${child.label || 'sub-item'}`}
                              onClick={() =>
                                update((d) => {
                                  d.primary[i].children!.splice(j, 1)
                                  if (d.primary[i].children!.length === 0) {
                                    delete d.primary[i].children
                                  }
                                })
                              }
                            >
                              ✕
                            </IconButton>
                          </li>
                        ))}
                      </ul>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        update((d) => {
                          d.primary[i].children = [
                            ...(d.primary[i].children ?? []),
                            { label: '', url: '' },
                          ]
                        })
                      }
                      className="ml-8 text-[11px] font-heading font-semibold text-brand-cyan hover:text-brand-navy transition-colors"
                    >
                      + Add sub-item
                    </button>
                  </li>
                ))}
              </ul>

              <div className="px-4 pb-4">
                <button
                  type="button"
                  onClick={() => update((d) => { d.primary.push({ label: '', url: '' }) })}
                  className="rounded-pill border border-brand-navy px-4 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
                >
                  + Add menu item
                </button>
              </div>
            </section>

            <section className="bg-surface-card border border-border-default rounded-lg">
              <div className="px-4 py-2 border-b border-border-default">
                <h2 className="text-sm font-heading font-semibold text-brand-navy">
                  Call-to-action button
                </h2>
                <p className="text-[11px] font-body text-text-muted mt-0.5">
                  Optional highlighted button at the end of the menu (e.g. “Get in touch”).
                </p>
              </div>
              <div className="p-4">
                {nav.cta ? (
                  <div className="flex items-center gap-2">
                    <ItemFields
                      item={nav.cta}
                      onLabel={(v) => update((d) => { d.cta = { ...d.cta!, label: v } })}
                      onUrl={(v) => update((d) => { d.cta = { ...d.cta!, url: v } })}
                    />
                    <IconButton
                      label="Remove call-to-action"
                      onClick={() => update((d) => { delete d.cta })}
                    >
                      ✕
                    </IconButton>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => update((d) => { d.cta = { label: '', url: '' } })}
                    className="rounded-pill border border-brand-navy px-4 py-1.5 text-xs font-heading font-semibold text-brand-navy hover:bg-brand-navy/5 transition-colors"
                  >
                    + Add call-to-action
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        {formUnavailable && (
          <div className="bg-warning/10 border border-warning/30 text-warning text-xs font-body rounded-lg px-4 py-3">
            The JSON is malformed, so the visual editor can&apos;t load it — fix it below
            and the form view will come back.
          </div>
        )}

        <section className="bg-surface-card border border-border-default rounded-lg">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            aria-expanded={showRaw || formUnavailable}
            className="w-full flex items-center justify-between px-4 py-2 text-left"
          >
            <span className="text-sm font-heading font-semibold text-brand-navy">
              Raw JSON ({path})
            </span>
            <span className="text-xs font-body text-text-muted">
              {showRaw || formUnavailable ? 'Hide' : 'Show'}
            </span>
          </button>
          {(showRaw || formUnavailable) && (
            <div className="border-t border-border-default">
              <textarea
                value={contents}
                onChange={(e) => onChange(e.target.value)}
                spellCheck={false}
                aria-label="nav.json source"
                className="w-full min-h-[320px] text-sm font-mono px-4 py-3 outline-none resize-y"
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
