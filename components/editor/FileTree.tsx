'use client'

import { useState } from 'react'

export type TreeFile = { path: string; sha: string }

// Sentinel selectedPath that opens the media library instead of a file.
export const MEDIA_VIEW = '__media__'
// Sentinel selectedPath that opens the Resources (blog) panel.
export const RESOURCES_VIEW = '__resources__'
// Sentinel selectedPath that opens the one-off content generator.
export const ONEOFF_VIEW = '__oneoff__'
// Sentinel selectedPath that opens the unpublished-changes review panel.
export const CHANGES_VIEW = '__changes__'
// Sentinel selectedPath that opens the AI theme/CSS studio (admin-only).
export const THEME_VIEW = '__theme__'
// Sentinel selectedPath that opens the Client Center portal-links editor.
export const CLIENT_CENTER_VIEW = '__client_center__'

const VIRTUAL_NAV = 'content/nav.json'

function isPage(path: string): boolean {
  return path.startsWith('content/pages/') && path.endsWith('.md')
}

function isPost(path: string): boolean {
  return path.startsWith('content/posts/') && path.endsWith('.md')
}

function isSocial(path: string): boolean {
  return path.startsWith('content/social/') && path.endsWith('.md')
}

function isDraft(path: string): boolean {
  return path.startsWith('content/drafts/') && path.endsWith('.md')
}

function isNav(path: string): boolean {
  return path === VIRTUAL_NAV
}

// Page filenames encode URL depth with `--` (services--tax--business-tax.md
// is /services/tax/business-tax). Surface that as indentation: parents first,
// children indented under them with the shared prefix stripped.
function pageSegments(path: string): string[] {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.md$/, '').split('--')
}

function sortPages(pages: TreeFile[]): TreeFile[] {
  // Compare segment-by-segment so "about.md" sorts before "about--our-story.md"
  // (plain alphabetical puts the child first because '-' < '.').
  return [...pages].sort((a, b) => {
    const sa = pageSegments(a.path)
    const sb = pageSegments(b.path)
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      if (sa[i] === undefined) return -1
      if (sb[i] === undefined) return 1
      const cmp = sa[i].localeCompare(sb[i])
      if (cmp !== 0) return cmp
    }
    return 0
  })
}

function fileButtonClass(selected: boolean): string {
  return `w-full text-left text-xs font-body px-2 py-1.5 rounded transition-colors ${
    selected
      ? 'bg-brand-cyan/10 text-brand-navy font-semibold'
      : 'text-text-secondary hover:bg-surface-subtle'
  }`
}

function DirtyDot() {
  return (
    <span
      role="img"
      aria-label="Unsaved changes"
      title="Unsaved changes"
      className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-warning align-middle"
    />
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path
        d="M6 4l4 4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SectionHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string
  count?: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 text-xs font-heading font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary px-2 mb-1 transition-colors"
      aria-expanded={open}
    >
      <Chevron open={open} />
      {label}
      {typeof count === 'number' && (
        <span className="font-body font-normal normal-case tracking-normal text-[10px]">
          ({count})
        </span>
      )}
    </button>
  )
}

export default function FileTree({
  entries,
  selectedPath,
  dirtyPaths,
  changesCount,
  showTheme,
  showConfiguration = true,
  onSelect,
  onNewPage,
  onBulkMove,
}: {
  entries: TreeFile[]
  selectedPath: string | null
  dirtyPaths: Set<string>
  changesCount: number
  // Admin-only Theme Studio entry — hidden for managers (route also 403s them).
  showTheme: boolean
  // The Configuration section (Navigation + Client Center) — hidden for Site
  // Owners, who edit page/resource content only.
  showConfiguration?: boolean
  onSelect: (path: string) => void
  onNewPage: () => void
  // Bulk-relocate selected pages (multi-select). Resolves true when all moved.
  onBulkMove?: (
    paths: string[],
    dest: { type: 'resources' } | { type: 'under'; parentUrl: string }
  ) => Promise<boolean>
}) {
  const pages = sortPages(entries.filter((e) => isPage(e.path)))
  const posts = entries.filter((e) => isPost(e.path))
  const drafts = entries.filter((e) => isDraft(e.path))
  const socialBySlug = new Map(
    entries
      .filter((e) => isSocial(e.path))
      .map((e) => [e.path.slice('content/social/'.length, -3), e])
  )
  const nav = entries.find((e) => isNav(e.path))

  // Page hierarchy is encoded in filenames via `--` (services--tax.md is a child
  // of services.md). Key each page by its slash-joined segments so prefixes model
  // ancestry: `services/tax` is a descendant of `services`. Prefix strings alone
  // drive collapse — no reliance on every intermediate parent file existing.
  const pageKeyList = pages.map((p) => pageSegments(p.path).join('/'))
  // Keys that have at least one descendant page → the rows that get a chevron.
  const expandableKeys = new Set<string>()
  for (const child of pageKeyList) {
    for (const anc of pageKeyList) {
      if (child !== anc && child.startsWith(anc + '/')) expandableKeys.add(anc)
    }
  }

  // Pages is the noisy section — start it collapsed; the rest are small.
  const [open, setOpen] = useState<Record<string, boolean>>({
    pages: false,
    resources: true,
    drafts: false,
    configuration: true,
    media: true,
  })
  const toggle = (key: string) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))

  // Multi-select for bulk moves (view state only — no localStorage per CLAUDE.md).
  // Only leaf pages (no descendants) are selectable; a parent move would orphan
  // its children. Checked holds selected page paths.
  const [selectMode, setSelectMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const toggleChecked = (path: string) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  const exitSelect = () => {
    setSelectMode(false)
    setChecked(new Set())
  }
  const runBulk = async (dest: { type: 'resources' } | { type: 'under'; parentUrl: string }) => {
    if (!onBulkMove || checked.size === 0) return
    setBulkBusy(true)
    const ok = await onBulkMove(Array.from(checked), dest)
    setBulkBusy(false)
    if (ok) exitSelect()
  }
  // Candidate parents for a bulk "Move under…" — every page except home and any
  // page currently checked (can't nest a page under itself).
  const bulkParents = pages
    .map((p) => {
      const segs = pageSegments(p.path)
      return { path: p.path, url: '/' + segs.join('/') }
    })
    .filter((c) => c.url !== '/home' && !checked.has(c.path))

  // Which page rows are expanded. Empty = all collapsed → only top-level pages
  // show; each parent opens to reveal its sub-pages. View state only (no
  // localStorage, per CLAUDE.md).
  const [expandedPages, setExpandedPages] = useState<Set<string>>(() => new Set())
  const togglePage = (key: string) =>
    setExpandedPages((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // A page shows only when every ancestor page (a real-file prefix) is expanded.
  const isPageVisible = (key: string): boolean => {
    for (const anc of pageKeyList) {
      if (key !== anc && key.startsWith(anc + '/') && !expandedPages.has(anc)) return false
    }
    return true
  }

  // Selecting a file from elsewhere (e.g. a freshly drafted post) auto-expands
  // its section so the highlight is never hidden. Render-phase derived-state
  // adjustment (the React-sanctioned alternative to a setState-in-effect).
  const [prevSelected, setPrevSelected] = useState<string | null>(null)
  if (selectedPath !== prevSelected) {
    setPrevSelected(selectedPath)
    const section = selectedPath
      ? isDraft(selectedPath)
        ? 'drafts'
        : isPage(selectedPath)
          ? 'pages'
          : isPost(selectedPath) || isSocial(selectedPath)
            ? 'resources'
            : isNav(selectedPath) || selectedPath === CLIENT_CENTER_VIEW
              ? 'configuration'
              : selectedPath === MEDIA_VIEW
                ? 'media'
                : selectedPath === ONEOFF_VIEW
                  ? 'resources'
                  : null
      : null
    if (section && !open[section]) setOpen({ ...open, [section]: true })

    // Reveal a selected sub-page by expanding each of its ancestor pages.
    if (selectedPath && isPage(selectedPath)) {
      const segs = pageSegments(selectedPath)
      const ancestors: string[] = []
      for (let k = 1; k < segs.length; k++) {
        const anc = segs.slice(0, k).join('/')
        if (pageKeyList.includes(anc)) ancestors.push(anc)
      }
      if (ancestors.some((a) => !expandedPages.has(a))) {
        setExpandedPages((prev) => new Set([...prev, ...ancestors]))
      }
    }
  }

  return (
    <nav className="w-64 border-r border-border-default bg-surface-card overflow-y-auto p-3">
      <button
        onClick={() => onSelect(CHANGES_VIEW)}
        className={`mb-4 w-full flex items-center justify-between gap-2 text-left text-xs font-heading font-semibold px-3 py-2 rounded-lg border transition-colors ${
          selectedPath === CHANGES_VIEW
            ? 'border-brand-navy bg-brand-navy/10 text-brand-navy'
            : 'border-border-default bg-surface-default text-brand-navy hover:bg-surface-subtle'
        }`}
      >
        <span>Review changes</span>
        {changesCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-brand-navy px-1.5 py-0.5 text-[10px] font-semibold text-text-inverse">
            {changesCount}
          </span>
        )}
      </button>

      {showTheme && (
        <button
          onClick={() => onSelect(THEME_VIEW)}
          className={`mb-4 w-full flex items-center gap-2 text-left text-xs font-heading font-semibold px-3 py-2 rounded-lg border transition-colors ${
            selectedPath === THEME_VIEW
              ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
              : 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-navy hover:bg-brand-cyan/10'
          }`}
        >
          <span className="text-brand-cyan" aria-hidden>
            ✦
          </span>
          Theme &amp; styling
        </button>
      )}

      <div className="flex items-center justify-between gap-1 pr-1">
        <div className="min-w-0 flex-1">
          <SectionHeader
            label="Pages"
            count={pages.length}
            open={open.pages}
            onToggle={() => toggle('pages')}
          />
        </div>
        {onBulkMove && pages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (selectMode) {
                exitSelect()
              } else {
                setSelectMode(true)
                if (!open.pages) setOpen({ ...open, pages: true })
              }
            }}
            title="Select pages to move in bulk"
            className="mb-1 shrink-0 rounded-pill border border-border-default px-2.5 py-1 font-heading text-[10px] font-semibold text-text-secondary transition-colors hover:bg-surface-subtle"
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        )}
        <button
          type="button"
          onClick={onNewPage}
          title="Create a new page"
          className="mb-1 shrink-0 rounded-pill bg-brand-cyan px-2.5 py-1 font-heading text-[10px] font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark"
        >
          + New page
        </button>
      </div>
      {open.pages && (
        <ul className="mb-4 pl-[18px]">
          {pages.length === 0 ? (
            <li className="text-xs text-text-muted px-2 py-1">No pages yet.</li>
          ) : (
            pages.map((p) => {
              const segs = pageSegments(p.path)
              const depth = segs.length - 1
              const label = depth === 0 ? `${segs[0]}.md` : segs[segs.length - 1]
              const key = segs.join('/')
              if (!isPageVisible(key)) return null
              const hasChildren = expandableKeys.has(key)
              const isOpen = expandedPages.has(key)
              return (
                <li key={p.path}>
                  <div
                    className="flex items-center"
                    style={depth > 0 ? { paddingLeft: `${depth * 14}px` } : undefined}
                  >
                    {selectMode &&
                      (!hasChildren ? (
                        <input
                          type="checkbox"
                          checked={checked.has(p.path)}
                          onChange={() => toggleChecked(p.path)}
                          aria-label={`Select ${label}`}
                          className="shrink-0 mr-1 h-3.5 w-3.5 accent-brand-cyan"
                        />
                      ) : (
                        <span className="shrink-0 w-[18px]" aria-hidden />
                      ))}
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={() => togglePage(key)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${label}`}
                        className="shrink-0 w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-brand-navy transition-colors"
                      >
                        <Chevron open={isOpen} />
                      </button>
                    ) : (
                      <span className="shrink-0 w-4" aria-hidden />
                    )}
                    <button
                      onClick={() => onSelect(p.path)}
                      className={`${fileButtonClass(selectedPath === p.path)} flex-1 min-w-0 truncate`}
                    >
                      {label}
                      {dirtyPaths.has(p.path) && <DirtyDot />}
                    </button>
                  </div>
                </li>
              )
            })
          )}
        </ul>
      )}

      {selectMode && checked.size > 0 && (
        <div className="mb-4 rounded-lg border border-brand-cyan/40 bg-brand-cyan/5 p-2">
          <p className="mb-1.5 px-1 font-body text-[11px] text-text-secondary">
            {checked.size} selected
          </p>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void runBulk({ type: 'resources' })}
              className="w-full rounded-pill bg-brand-cyan px-3 py-1.5 font-heading text-[11px] font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bulkBusy ? 'Moving…' : 'Move to Resources'}
            </button>
            {bulkParents.length > 0 && (
              <select
                aria-label="Move selected pages under another page"
                value=""
                disabled={bulkBusy}
                onChange={(e) => {
                  const url = e.target.value
                  if (url) void runBulk({ type: 'under', parentUrl: url })
                }}
                className="w-full rounded-pill border border-brand-navy bg-surface-default px-3 py-1.5 font-heading text-[11px] font-semibold text-brand-navy disabled:opacity-50"
              >
                <option value="">Move under…</option>
                {bulkParents.map((c) => (
                  <option key={c.path} value={c.url}>
                    {c.url}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      <SectionHeader
        label="Resources"
        count={posts.length}
        open={open.resources}
        onToggle={() => toggle('resources')}
      />
      {open.resources && (
        <ul className="mb-4 pl-[18px]">
          <li className="mb-2">
            <button
              onClick={() => onSelect(RESOURCES_VIEW)}
              className={`w-full text-left text-xs font-heading font-semibold px-3 py-2 rounded-lg border transition-colors ${
                selectedPath === RESOURCES_VIEW
                  ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
                  : 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-navy hover:bg-brand-cyan/10'
              }`}
            >
              <span className="text-brand-cyan mr-1.5" aria-hidden>
                ✦
              </span>
              Blog ideas &amp; drafting
            </button>
          </li>
          <li className="mb-2">
            <button
              onClick={() => onSelect(ONEOFF_VIEW)}
              className={`w-full text-left text-xs font-heading font-semibold px-3 py-2 rounded-lg border transition-colors ${
                selectedPath === ONEOFF_VIEW
                  ? 'border-brand-cyan bg-brand-cyan/10 text-brand-navy'
                  : 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-navy hover:bg-brand-cyan/10'
              }`}
            >
              <span className="text-brand-cyan mr-1.5" aria-hidden>
                ⚡
              </span>
              One-off content
            </button>
          </li>
          {posts.length === 0 ? (
            <li className="text-xs text-text-muted px-2 py-1">No posts drafted yet.</li>
          ) : (
            posts.map((p) => {
              const slug = p.path.slice('content/posts/'.length, -3)
              const social = socialBySlug.get(slug)
              return (
                <li key={p.path}>
                  <button
                    onClick={() => onSelect(p.path)}
                    className={fileButtonClass(selectedPath === p.path)}
                  >
                    {p.path.split('/').pop()}
                    {dirtyPaths.has(p.path) && <DirtyDot />}
                  </button>
                  {social && (
                    <button
                      onClick={() => onSelect(social.path)}
                      style={{ paddingLeft: '22px' }}
                      className={fileButtonClass(selectedPath === social.path)}
                    >
                      <span className="text-text-muted mr-1" aria-hidden>
                        └
                      </span>
                      social posts
                      {dirtyPaths.has(social.path) && <DirtyDot />}
                    </button>
                  )}
                </li>
              )
            })
          )}
        </ul>
      )}

      {drafts.length > 0 && (
        <>
          <SectionHeader
            label="Drafts"
            count={drafts.length}
            open={open.drafts}
            onToggle={() => toggle('drafts')}
          />
          {open.drafts && (
            <ul className="mb-4 pl-[18px]">
              {drafts.map((d) => (
                <li key={d.path}>
                  <button
                    onClick={() => onSelect(d.path)}
                    className={fileButtonClass(selectedPath === d.path)}
                  >
                    {d.path.split('/').pop()}
                    {dirtyPaths.has(d.path) && <DirtyDot />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {showConfiguration && (
        <>
          <SectionHeader
            label="Configuration"
            open={open.configuration}
            onToggle={() => toggle('configuration')}
          />
          {open.configuration && (
            <ul className="mb-4 pl-[18px]">
              {nav ? (
                <li>
                  <button
                    onClick={() => onSelect(nav.path)}
                    className={fileButtonClass(selectedPath === nav.path)}
                  >
                    Navigation (nav.json)
                    {dirtyPaths.has(nav.path) && <DirtyDot />}
                  </button>
                </li>
              ) : (
                <li className="text-xs text-text-muted px-2 py-1">nav.json missing</li>
              )}
              <li>
                <button
                  onClick={() => onSelect(CLIENT_CENTER_VIEW)}
                  className={fileButtonClass(selectedPath === CLIENT_CENTER_VIEW)}
                >
                  Client Center
                </button>
              </li>
            </ul>
          )}
        </>
      )}

      <SectionHeader label="Media" open={open.media} onToggle={() => toggle('media')} />
      {open.media && (
        <ul className="pl-[18px]">
          <li>
            <button
              onClick={() => onSelect(MEDIA_VIEW)}
              className={fileButtonClass(selectedPath === MEDIA_VIEW)}
            >
              Image library
            </button>
          </li>
        </ul>
      )}
    </nav>
  )
}
