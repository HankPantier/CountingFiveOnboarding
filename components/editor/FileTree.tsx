'use client'

export type TreeFile = { path: string; sha: string }

// Sentinel selectedPath that opens the media library instead of a file.
export const MEDIA_VIEW = '__media__'
// Sentinel selectedPath that opens the Resources (blog) panel.
export const RESOURCES_VIEW = '__resources__'

const VIRTUAL_NAV = 'content/nav.json'

function displayName(path: string): string {
  const base = path.split('/').pop() ?? path
  return base
}

function isPage(path: string): boolean {
  return path.startsWith('content/pages/') && path.endsWith('.md')
}

function isPost(path: string): boolean {
  return path.startsWith('content/posts/') && path.endsWith('.md')
}

function isNav(path: string): boolean {
  return path === VIRTUAL_NAV
}

export default function FileTree({
  entries,
  selectedPath,
  dirtyPaths,
  onSelect,
}: {
  entries: TreeFile[]
  selectedPath: string | null
  dirtyPaths: Set<string>
  onSelect: (path: string) => void
}) {
  const pages = entries.filter((e) => isPage(e.path))
  const posts = entries.filter((e) => isPost(e.path))
  const nav = entries.find((e) => isNav(e.path))

  return (
    <nav className="w-64 border-r border-border-default bg-surface-card overflow-y-auto p-3">
      <div className="text-xs font-heading font-semibold uppercase tracking-wide text-text-muted px-2 mb-2">
        Pages
      </div>
      <ul className="mb-6">
        {pages.length === 0 ? (
          <li className="text-xs text-text-muted px-2 py-1">No pages yet.</li>
        ) : (
          pages.map((p) => (
            <li key={p.path}>
              <button
                onClick={() => onSelect(p.path)}
                className={`w-full text-left text-xs font-body px-2 py-1.5 rounded transition-colors ${
                  selectedPath === p.path
                    ? 'bg-brand-cyan/10 text-brand-navy font-semibold'
                    : 'text-text-secondary hover:bg-surface-subtle'
                }`}
              >
                {displayName(p.path)}
                {dirtyPaths.has(p.path) && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle" />
                )}
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="text-xs font-heading font-semibold uppercase tracking-wide text-text-muted px-2 mb-2">
        Resources
      </div>
      <ul className="mb-6">
        <li>
          <button
            onClick={() => onSelect(RESOURCES_VIEW)}
            className={`w-full text-left text-xs font-body px-2 py-1.5 rounded transition-colors ${
              selectedPath === RESOURCES_VIEW
                ? 'bg-brand-cyan/10 text-brand-navy font-semibold'
                : 'text-text-secondary hover:bg-surface-subtle'
            }`}
          >
            Blog ideas &amp; drafting
          </button>
        </li>
        {posts.map((p) => (
          <li key={p.path}>
            <button
              onClick={() => onSelect(p.path)}
              className={`w-full text-left text-xs font-body px-2 py-1.5 rounded transition-colors ${
                selectedPath === p.path
                  ? 'bg-brand-cyan/10 text-brand-navy font-semibold'
                  : 'text-text-secondary hover:bg-surface-subtle'
              }`}
            >
              {displayName(p.path)}
              {dirtyPaths.has(p.path) && (
                <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-warning align-middle" />
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className="text-xs font-heading font-semibold uppercase tracking-wide text-text-muted px-2 mb-2">
        Configuration
      </div>
      <ul>
        {nav ? (
          <li>
            <button
              onClick={() => onSelect(nav.path)}
              className={`w-full text-left text-xs font-body px-2 py-1.5 rounded transition-colors ${
                selectedPath === nav.path
                  ? 'bg-brand-cyan/10 text-brand-navy font-semibold'
                  : 'text-text-secondary hover:bg-surface-subtle'
              }`}
            >
              Navigation (nav.json)
              {dirtyPaths.has(nav.path) && (
                <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle" />
              )}
            </button>
          </li>
        ) : (
          <li className="text-xs text-text-muted px-2 py-1">nav.json missing</li>
        )}
      </ul>

      <div className="text-xs font-heading font-semibold uppercase tracking-wide text-text-muted px-2 mb-2 mt-6">
        Media
      </div>
      <ul>
        <li>
          <button
            onClick={() => onSelect(MEDIA_VIEW)}
            className={`w-full text-left text-xs font-body px-2 py-1.5 rounded transition-colors ${
              selectedPath === MEDIA_VIEW
                ? 'bg-brand-cyan/10 text-brand-navy font-semibold'
                : 'text-text-secondary hover:bg-surface-subtle'
            }`}
          >
            Image library
          </button>
        </li>
      </ul>
    </nav>
  )
}
