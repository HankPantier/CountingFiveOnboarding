import { describe, it, expect } from 'vitest'
import { renderComposed } from './render-composed'
import { HAS_CHROME, TEST_HTML, defineRealChromeSuite } from './real-chrome-suite'

// Local Chrome with its default flags (multi-process).
defineRealChromeSuite('default flags', null)

describe('renderComposed without a browser', () => {
  it.skipIf(HAS_CHROME)('throws RendererUnavailableError when no Chromium is configured', async () => {
    await expect(renderComposed({ html: TEST_HTML, shellOrigin: 'https://example.invalid/', viewport: 'mobile' })).rejects.toThrow(
      /CHROMIUM_EXECUTABLE_PATH/
    )
  })
})
