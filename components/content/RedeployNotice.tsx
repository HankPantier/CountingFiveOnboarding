import type { SkippedFile, SkipReason } from '@/lib/content/deploy-plan'

const REASON_LABEL: Record<SkipReason, string> = {
  'site-config': 'site setting',
  edited: 'edited on draft',
  removed: 'moved or removed on draft',
  created: 'added on draft',
}

// Lists the draft files a re-deploy keeps as they are. `when` picks the copy:
// 'before' warns ahead of a re-package, 'after' reports what the push skipped.
export default function RedeployNotice({ files, when }: { files: SkippedFile[]; when: 'before' | 'after' }) {
  return (
    <div className="bg-info/10 border border-info/20 text-info text-sm font-body rounded-lg px-4 py-2 space-y-1">
      <div className="font-heading font-semibold">
        {when === 'before'
          ? 'This site was deployed before. Re-packaging only refreshes generated files nobody has changed since; redirects are merged, not replaced.'
          : 'Re-deploy kept these draft files as they were (not overwritten).'}
      </div>
      {files.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer">
            {files.length} file(s) {when === 'before' ? 'will be kept as-is' : 'kept as-is'}
          </summary>
          <ul className="font-mono space-y-0.5 pt-1">
            {files.slice(0, 50).map((f) => (
              <li key={f.path}>
                {f.path} <span className="text-text-muted">({REASON_LABEL[f.reason]})</span>
              </li>
            ))}
            {files.length > 50 && <li>…and {files.length - 50} more</li>}
          </ul>
        </details>
      ) : (
        <div className="text-xs">No draft edits to keep — every generated file will be refreshed.</div>
      )}
    </div>
  )
}
