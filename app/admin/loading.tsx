// Route-level pending state for every /admin page: the sidebar shell stays
// mounted (it lives in the layout) while the page content shows a spinner
// instead of blocking navigation on the server fetch.
export default function AdminLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border-default border-t-brand-cyan" />
    </div>
  )
}
