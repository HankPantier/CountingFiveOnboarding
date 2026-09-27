// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { installModalKeyboard, modalFocusables } from './modal-keyboard'

function setup() {
  document.body.innerHTML = `
    <button id="opener">Annotate</button>
    <div id="dialog" role="dialog" tabindex="-1">
      <button id="first">Box tool</button>
      <button id="disabled" disabled>Undo</button>
      <div class="hidden"><input id="file" type="file" /></div>
      <button id="last">Attach</button>
    </div>`
  const opener = document.getElementById('opener') as HTMLButtonElement
  opener.focus()
  return { opener, dialog: document.getElementById('dialog') as HTMLElement }
}

const key = (k: string, shift = false) => {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })
  document.activeElement?.dispatchEvent(e)
  return e
}
const focusedId = () => (document.activeElement as HTMLElement | null)?.id

describe('installModalKeyboard', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('moves focus into the dialog on open', () => {
    const { dialog } = setup()
    installModalKeyboard(dialog, { onEscape: () => {} })
    expect(document.activeElement).toBe(dialog)
  })

  it('only visible, enabled controls are Tab stops (a hidden file input never is)', () => {
    const { dialog } = setup()
    expect(modalFocusables(dialog).map((el) => el.id)).toEqual(['first', 'last'])
  })

  it('traps Tab and Shift+Tab inside the dialog', () => {
    const { dialog } = setup()
    installModalKeyboard(dialog, { onEscape: () => {} })
    expect(key('Tab').defaultPrevented).toBe(true)
    expect(focusedId()).toBe('first')
    ;(document.getElementById('last') as HTMLElement).focus()
    key('Tab')
    expect(focusedId()).toBe('first')
    key('Tab', true)
    expect(focusedId()).toBe('last')
  })

  it('Escape closes, unless the dialog cannot close right now', () => {
    const { dialog } = setup()
    const onEscape = vi.fn()
    let busy = true
    installModalKeyboard(dialog, { onEscape, canClose: () => !busy })
    key('Escape')
    expect(onEscape).not.toHaveBeenCalled()
    busy = false
    key('Escape')
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('cleanup removes the listener and returns focus to the opener', () => {
    const { opener, dialog } = setup()
    const onEscape = vi.fn()
    const cleanup = installModalKeyboard(dialog, { onEscape })
    cleanup()
    expect(document.activeElement).toBe(opener)
    key('Escape')
    expect(onEscape).not.toHaveBeenCalled()
  })
})
