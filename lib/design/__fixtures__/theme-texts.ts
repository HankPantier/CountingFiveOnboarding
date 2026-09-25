import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { DesignBundle } from '../bundle'

const FIX = path.join(process.cwd(), 'lib', 'content', '__fixtures__')
export const BRAND_TEXT = readFileSync(path.join(FIX, 'brand.golden.json'), 'utf-8')
export const DESIGN_TEXT = readFileSync(path.join(FIX, 'design.golden.json'), 'utf-8')
export const THEME_CSS_TEXT = readFileSync(path.join(FIX, 'theme.css.golden'), 'utf-8')
export const DRAFT_FILES = { brandText: BRAND_TEXT, designText: DESIGN_TEXT, overridesCss: '' }

// A bundle as the MODEL returns it: no schemaVersion, no meta.
export function rawOf(bundle: DesignBundle): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...bundle }
  delete raw.schemaVersion
  delete raw.meta
  return raw
}
