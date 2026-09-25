import { useRef } from 'react'
import { syncedScrollTop } from '@/lib/design/studio-ui'

// Scrolling any registered pane scrolls the others to the same relative
// position (CompareGrid rows, BeforeAfter rows).
export function useSyncedScroll(): { register: (i: number) => (el: HTMLDivElement | null) => void; onScroll: (i: number) => void } {
  const panes = useRef<(HTMLDivElement | null)[]>([])
  const syncing = useRef(false)
  const register = (i: number) => (el: HTMLDivElement | null) => {
    panes.current[i] = el
  }
  const onScroll = (i: number) => {
    if (syncing.current) return
    const source = panes.current[i]
    if (!source) return
    syncing.current = true
    panes.current.forEach((pane, j) => {
      if (!pane || j === i) return
      pane.scrollTop = syncedScrollTop(source.scrollTop, source.scrollHeight - source.clientHeight, pane.scrollHeight - pane.clientHeight)
    })
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }
  return { register, onScroll }
}
