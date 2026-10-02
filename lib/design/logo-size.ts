// Pure + client-safe. The template's header/footer logo size (template
// 2026.09.8): design.json `logo.size` 'large' → <html data-c5-logo-size="large">
// → 44px header (40px on phones) and 40px footer, instead of 32px. Omitted at
// 'standard'. Deliberately NOT a style axis (lib/design/style-axes.ts): a
// Design Studio concept replaces `style` wholesale, which would reset it, and
// the critic never scores the logo. bundleToRepoFiles carries `logo` through.
import type { DesignJson } from '@/types/design-json'

export type LogoSize = NonNullable<NonNullable<DesignJson['logo']>['size']>
export const LOGO_SIZES = ['standard', 'large'] as const satisfies readonly LogoSize[]
export const LOGO_SIZE_ATTRIBUTE = 'data-c5-logo-size'

/** design.json → the Controls' logo size ('standard' when absent or unrecognised). */
export function logoSizeOf(design: Pick<DesignJson, 'logo'> | null | undefined): LogoSize {
  return design?.logo?.size === 'large' ? 'large' : 'standard'
}

/** The preview's <html> rewrite: 'large' sets the hook, anything else removes it
 * (null), so a live 'large' the draft dropped goes. Inert on shells older than
 * template 2026.09.8 (no logo-size.css there to match it). */
export function logoSizeHtmlAttribute(size: string | undefined): Record<string, string | null> {
  return { [LOGO_SIZE_ATTRIBUTE]: size === 'large' ? 'large' : null }
}

// brand.json logo.tone → <html data-c5-logo-tone="light"> (template 2026.09.6,
// src/lib/brand/logo-tone.ts). Lives here beside the size attribute so the
// preview composer's allowlist can import both from one client-safe module.
export const LOGO_TONE_ATTRIBUTE = 'data-c5-logo-tone'
