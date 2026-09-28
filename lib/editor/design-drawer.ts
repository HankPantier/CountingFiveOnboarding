import { DEFAULT_CHAT_PAGE } from '@/lib/design/chat-types'
import { pagePathToUrl } from './sidebar-nav-tree'

const PAGE_FILE = /^content\/pages\/[^/]+\.md$/

// The site route the editor's Design drawer previews (and the chat renders):
// the selected page file's URL, else the homepage for anything that isn't a
// page (nav.json, a resource, a panel view).
export function designPreviewRoute(selectedPath: string | null): string {
  return selectedPath && PAGE_FILE.test(selectedPath) ? pagePathToUrl(selectedPath) : DEFAULT_CHAT_PAGE
}
