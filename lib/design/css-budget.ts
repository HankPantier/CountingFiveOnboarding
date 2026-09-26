// Pure. The Design Studio CSS size caps and the one way they're measured —
// shared by the sanitizer (which enforces them) and the revise prompt (which
// shows the model its budget), so the two can never disagree on a count.
import { Buffer } from 'node:buffer'

export const MAX_GLOBAL_BYTES = 16_000
export const MAX_GLOBAL_LINES = 400
export const MAX_TARGET_BYTES = 4_000
export const MAX_TARGET_LINES = 60
// Spec: 16 KB / 400 lines for the WHOLE managed region (global + every
// target), on top of the per-fragment caps — otherwise ~25 targets could
// write ~116 KB into design-overrides.css.
export const MAX_TOTAL_BYTES = 16_000
export const MAX_TOTAL_LINES = 400

export type CssSizeScope = 'global' | 'target'

export const cssCaps = (scope: CssSizeScope): { maxBytes: number; maxLines: number } =>
  scope === 'global' ? { maxBytes: MAX_GLOBAL_BYTES, maxLines: MAX_GLOBAL_LINES } : { maxBytes: MAX_TARGET_BYTES, maxLines: MAX_TARGET_LINES }

// Bytes are measured on the trimmed input; lines on the trimmed text split on
// '\n' (the sanitizer counts its serialized output, which for already-sanitized
// CSS — what a stored bundle carries — is the same text).
export const cssByteLength = (css: string): number => Buffer.byteLength(css.trim(), 'utf8')
export const countCssLines = (css: string): number => css.trim().split('\n').length

export const cssTooLargeError = (maxBytes: number): string => `The CSS is too large (max ${maxBytes} bytes).`
export const cssTooManyLinesError = (lines: number, maxLines: number): string => `The CSS has ${lines} lines (max ${maxLines}).`

// The whole region's size over its fragments (already sanitized).
export function totalCssSize(fragments: (string | undefined)[]): { bytes: number; lines: number } {
  let bytes = 0
  let lines = 0
  for (const f of fragments) {
    if (!f?.trim()) continue
    bytes += cssByteLength(f)
    lines += countCssLines(f)
  }
  return { bytes, lines }
}

export function totalCssErrors(fragments: (string | undefined)[]): string[] {
  const { bytes, lines } = totalCssSize(fragments)
  const errors: string[] = []
  if (bytes > MAX_TOTAL_BYTES) errors.push(`css (total): ${cssTooLargeError(MAX_TOTAL_BYTES)}`)
  if (lines > MAX_TOTAL_LINES) errors.push(`css (total): ${cssTooManyLinesError(lines, MAX_TOTAL_LINES)}`)
  return errors
}

// A size-cap error as bundleToRepoFiles reports it ("css.global: …" /
// "css.blocks.<key>: …" / "css (total): …"), optionally unprefixed.
const SIZE_ERROR = /^(?:css(?:\.(?:global|blocks\.[a-z-]+)| \(total\)): )?The CSS (?:is too large \(max \d+ bytes\)|has \d+ lines \(max \d+\))\.$/
export const isCssSizeCapError = (error: string): boolean => SIZE_ERROR.test(error)
