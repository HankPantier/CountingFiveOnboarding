// Client-side keyboard contract for the Design Studio's modal dialogs
// (AnnotateCanvas): focus moves into the dialog, Tab / Shift+Tab cycle only
// through its VISIBLE enabled controls, Escape closes it (unless the dialog
// says it can't close right now, e.g. mid-upload), and focus returns to the
// control that opened it once it closes.
import { FOCUSABLE_SELECTOR, trapFocusIndex } from './studio-ui'

// Hidden via the `hidden` attribute, `inert`, Tailwind's `hidden` class or
// aria-hidden: never a Tab stop (a display:none file input would otherwise
// count as the first/last control and swallow the wrap-around).
const HIDDEN_ANCESTOR = '[hidden], [inert], [aria-hidden="true"], .hidden'

export function modalFocusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => !el.closest(HIDDEN_ANCESTOR))
}

export type ModalKeyboardOptions = {
  onEscape: () => void
  // False while the dialog must stay open (Escape is then ignored).
  canClose?: () => boolean
}

/**
 * Wire the keyboard contract onto `dialog`. Call on mount; the returned
 * cleanup (call on unmount) removes the listener and restores focus to the
 * opener if it is still in the document.
 */
export function installModalKeyboard(dialog: HTMLElement, opts: ModalKeyboardOptions): () => void {
  const doc = dialog.ownerDocument
  const opener = doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null
  dialog.focus()
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (opts.canClose && !opts.canClose()) return
      e.preventDefault()
      e.stopPropagation()
      opts.onEscape()
      return
    }
    if (e.key !== 'Tab') return
    const focusables = modalFocusables(dialog)
    if (focusables.length === 0) {
      e.preventDefault()
      dialog.focus()
      return
    }
    const next = trapFocusIndex(focusables.indexOf(doc.activeElement as HTMLElement), focusables.length, e.shiftKey)
    if (next !== null) {
      e.preventDefault()
      focusables[next]?.focus()
    }
  }
  doc.addEventListener('keydown', onKey)
  return () => {
    doc.removeEventListener('keydown', onKey)
    if (opener?.isConnected) opener.focus()
  }
}
