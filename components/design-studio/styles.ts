// Shared Tailwind class strings for the Design Studio — design tokens only
// (raw-docs/design.md): pill buttons, brand colours, visible focus rings.
export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan'

export const PRIMARY_BTN = `rounded-pill bg-brand-cyan px-3.5 py-1.5 font-heading text-xs font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
export const SECONDARY_BTN = `rounded-pill border border-border-default px-3.5 py-1.5 font-heading text-xs font-semibold text-text-secondary transition-colors hover:border-brand-cyan hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
export const PRIMARY_BTN_SM = `rounded-pill bg-brand-cyan px-3 py-1 font-heading text-[11px] font-semibold text-text-inverse transition-all hover:bg-brand-cyan-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
export const SECONDARY_BTN_SM = `rounded-pill border border-border-default px-3 py-1 font-heading text-[11px] font-semibold text-text-secondary transition-colors hover:border-brand-cyan hover:text-brand-navy disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`
export const CHIP = `rounded-pill border border-border-default bg-surface-card px-2.5 py-1 font-body text-[11px] text-text-secondary transition-colors hover:border-brand-cyan hover:text-brand-navy ${FOCUS}`
export const LINK_BTN = `self-start rounded-pill px-2 py-1 font-heading text-[11px] font-semibold text-text-secondary hover:text-brand-navy ${FOCUS}`
export const FIELD = 'min-w-0 rounded-pill border border-border-default bg-surface-card px-3.5 py-1.5 font-body text-xs text-text-primary focus:border-brand-cyan focus:outline-none'
export const TEXTAREA = 'min-w-0 resize-y rounded-2xl border border-border-default bg-surface-card px-3.5 py-1.5 font-body text-xs text-text-primary focus:border-brand-cyan focus:outline-none'
export const PANEL = 'flex min-w-0 flex-col gap-4 rounded-xl border border-border-default bg-surface-card p-4 shadow-subtle'
