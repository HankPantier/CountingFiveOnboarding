// Representative Ink & Clay blocks for the Theme Studio preview. This is an
// APPROXIMATION of the Phase II template — self-contained markup + CSS that
// consumes the same design tokens (--color-*, --radius-*, --c5-space-*, the
// Ink & Clay type scale) the real blocks use, so a palette / roundness / spacing
// change reflects instantly. Each block carries its real data-block attribute so
// content/design-overrides.css targets it exactly as it does in production. It is
// NOT pixel-identical to the deployed site (no Tailwind, no real content).

// Base stylesheet: the Ink & Clay foundation (mirrored from the template's
// globals.css) plus preview-only layout primitives. Loaded BEFORE the client's
// theme.css so theme.css tokens win; design-overrides.css is loaded last.
export const PREVIEW_BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--color-background, #fff);
  color: var(--color-foreground, #111);
  font-family: var(--font-body);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

/* Fonts: v1 does not swap fonts, so mirror the template's hardcoded pairing
   (Public Sans + Fraunces accent) by resolving the *-loaded vars theme.css
   references. Loaded via a Google Fonts <link> in the srcdoc. */
:root {
  --font-heading-loaded: "Public Sans", system-ui, sans-serif;
  --font-body-loaded: "Public Sans", system-ui, sans-serif;
  --font-accent-loaded: "Fraunces", Georgia, serif;
  --font-accent: var(--font-accent-loaded);

  --type-display: clamp(2.4rem, 1.4rem + 3.4vw, 3.6rem);
  --type-h2: clamp(1.5rem, 1.15rem + 1.3vw, 2.1rem);
  --type-h3: 1.3rem;
  --type-body-lg: 1.125rem;
  --type-small: 0.875rem;
  --type-caption: 0.75rem;
}

h1, h2, h3 { font-family: var(--font-heading); margin: 0; }
p { margin: 0; }

.pv-wrap { max-width: 1040px; margin: 0 auto; padding: 0 24px; }
.pv-section { padding: var(--c5-space-xl, 48px) 0; }
.pv-kicker {
  font-size: var(--type-caption); letter-spacing: 0.16em; text-transform: uppercase;
  font-weight: 600; color: var(--color-action); margin-bottom: 12px;
}
.font-accent { font-family: var(--font-accent); font-style: italic; font-weight: 400; }

.pv-btn {
  display: inline-block; padding: 12px 26px; border-radius: var(--radius-pill, 9999px);
  background: var(--color-action); color: var(--color-action-foreground, #fff);
  font-family: var(--font-heading); font-weight: 600; font-size: 0.95rem; text-decoration: none;
  border: none; cursor: default;
}
.pv-btn--ghost {
  background: transparent; color: var(--color-primary-foreground, #fff);
  border: 1px solid currentColor;
}
.pv-card {
  border: 1px solid color-mix(in srgb, var(--color-primary) 12%, transparent);
  border-radius: var(--radius-lg, 12px);
  background: var(--color-card, #fff);
  box-shadow: var(--shadow-card, 0 2px 8px rgba(0,0,0,0.08));
  padding: var(--c5-space-lg, 24px);
}
.pv-grid { display: grid; gap: var(--c5-space-lg, 24px); }
.pv-grid--3 { grid-template-columns: repeat(3, 1fr); }
.pv-muted { color: var(--color-muted-foreground, #667); }

/* hero — statement hero on the primary band */
[data-block="hero"] {
  background: var(--color-primary); color: var(--color-primary-foreground, #fff);
  padding: 88px 0;
}
[data-block="hero"] h1 { font-size: var(--type-display); line-height: 1.04; letter-spacing: -0.02em; font-weight: 700; max-width: 18ch; }
[data-block="hero"] .pv-lede { font-size: var(--type-body-lg); opacity: 0.9; margin-top: 20px; max-width: 46ch; }
[data-block="hero"] .pv-actions { margin-top: 32px; display: flex; gap: 14px; }

/* feature-grid */
[data-block="feature-grid"] h2, [data-block="service-cards"] h2,
[data-block="pricing"] h2, [data-block="testimonials"] h2 {
  font-size: var(--type-h2); text-align: center; margin-bottom: 8px; font-weight: 700;
}
[data-block="feature-grid"] .pv-sub, [data-block="service-cards"] .pv-sub,
[data-block="pricing"] .pv-sub { text-align: center; color: var(--color-muted-foreground); margin-bottom: 32px; }
[data-block="feature-grid"] .pv-icon {
  width: 40px; height: 40px; border-radius: var(--radius-md, 8px);
  background: color-mix(in srgb, var(--color-action) 14%, var(--color-near-white));
  border: 1px solid color-mix(in srgb, var(--color-action) 30%, transparent);
  color: var(--color-primary); display: flex; align-items: center; justify-content: center;
  font-weight: 700; margin-bottom: 14px;
}
[data-block="feature-grid"] h3, [data-block="service-cards"] h3 { font-size: var(--type-h3); margin-bottom: 8px; }

/* service-cards */
[data-block="service-cards"] .pv-link { color: var(--color-primary); font-weight: 600; font-size: var(--type-small); text-decoration: none; }

/* stats-bar — full-bleed accent band */
[data-block="stats-bar"] { background: var(--color-primary); color: var(--color-primary-foreground, #fff); }
[data-block="stats-bar"] .pv-grid { grid-template-columns: repeat(3, 1fr); text-align: center; }
[data-block="stats-bar"] .pv-stat { font-family: var(--font-heading); font-size: 2.6rem; font-weight: 700; }
[data-block="stats-bar"] .pv-stat-label { opacity: 0.85; font-size: var(--type-small); }

/* pricing */
[data-block="pricing"] .pv-tier--hi { background: var(--color-primary); color: var(--color-primary-foreground, #fff); border-color: var(--color-primary); }
[data-block="pricing"] .pv-price { font-family: var(--font-heading); font-size: 2.2rem; font-weight: 700; margin: 8px 0; }
[data-block="pricing"] .pv-badge {
  display: inline-block; font-size: var(--type-caption); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; padding: 3px 10px; border-radius: var(--radius-pill, 9999px);
  background: var(--color-action); color: var(--color-action-foreground, #fff); margin-bottom: 10px;
}
[data-block="pricing"] ul { list-style: none; padding: 0; margin: 14px 0 0; font-size: var(--type-small); }
[data-block="pricing"] li { padding: 5px 0; }

/* testimonials */
[data-block="testimonials"] blockquote { margin: 0 0 14px; font-size: var(--type-body-lg); font-family: var(--font-accent); font-style: italic; }
[data-block="testimonials"] .pv-cite { font-weight: 600; font-size: var(--type-small); }

/* cta-banner — complementary band */
[data-block="cta-banner"] { background: var(--color-complementary); color: #fff; text-align: center; }
[data-block="cta-banner"] h2 { font-size: var(--type-h2); font-weight: 700; margin-bottom: 20px; }

/* footer — dark anchor */
[data-block="footer"] { background: var(--color-footer, #111); color: var(--color-footer-foreground, #fff); padding: 40px 0; }
[data-block="footer"] .pv-muted { color: color-mix(in srgb, var(--color-footer-foreground, #fff) 70%, transparent); }
`

// The gallery markup. Kept content-neutral (a generic CPA firm) so the preview
// reads as "your theme, applied," not a specific client.
export const SAMPLE_BLOCKS_HTML = `
<section data-block="hero">
  <div class="pv-wrap">
    <div class="pv-kicker">Trusted since 1972</div>
    <h1>Accounting that <span class="font-accent">actually</span> moves you forward.</h1>
    <p class="pv-lede">Proactive tax strategy and advisory for owners who want a partner, not a once-a-year filing service.</p>
    <div class="pv-actions">
      <a class="pv-btn" href="#">Book a consultation</a>
      <a class="pv-btn pv-btn--ghost" href="#">Our services</a>
    </div>
  </div>
</section>

<section data-block="feature-grid" class="pv-section">
  <div class="pv-wrap">
    <h2>Why firms choose us</h2>
    <p class="pv-sub">A few of the things we do differently.</p>
    <div class="pv-grid pv-grid--3">
      <div class="pv-card"><div class="pv-icon">✓</div><h3>Proactive planning</h3><p class="pv-muted">Quarterly reviews, not a year-end scramble.</p></div>
      <div class="pv-card"><div class="pv-icon">◷</div><h3>Responsive team</h3><p class="pv-muted">Real people who answer the phone.</p></div>
      <div class="pv-card"><div class="pv-icon">↗</div><h3>Growth focused</h3><p class="pv-muted">Advice tuned to where you're headed.</p></div>
    </div>
  </div>
</section>

<section data-block="service-cards" class="pv-section">
  <div class="pv-wrap">
    <h2>Services</h2>
    <p class="pv-sub">Full-service accounting under one roof.</p>
    <div class="pv-grid pv-grid--3">
      <div class="pv-card"><h3>Tax strategy</h3><p class="pv-muted">Planning and preparation for individuals and businesses.</p><a class="pv-link" href="#">Learn more →</a></div>
      <div class="pv-card"><h3>Advisory</h3><p class="pv-muted">CFO-level guidance for growing companies.</p><a class="pv-link" href="#">Learn more →</a></div>
      <div class="pv-card"><h3>Bookkeeping</h3><p class="pv-muted">Clean books, on time, every month.</p><a class="pv-link" href="#">Learn more →</a></div>
    </div>
  </div>
</section>

<section data-block="stats-bar" class="pv-section">
  <div class="pv-wrap">
    <div class="pv-grid">
      <div><div class="pv-stat">50+</div><div class="pv-stat-label">Years serving the region</div></div>
      <div><div class="pv-stat">1,200</div><div class="pv-stat-label">Clients advised</div></div>
      <div><div class="pv-stat">4.9★</div><div class="pv-stat-label">Average review</div></div>
    </div>
  </div>
</section>

<section data-block="pricing" class="pv-section">
  <div class="pv-wrap">
    <h2>Simple, transparent pricing</h2>
    <p class="pv-sub">Pick the level of support that fits.</p>
    <div class="pv-grid pv-grid--3">
      <div class="pv-card"><h3>Essentials</h3><div class="pv-price">$250<span style="font-size:0.9rem">/mo</span></div><ul><li>Monthly bookkeeping</li><li>Annual tax filing</li><li>Email support</li></ul></div>
      <div class="pv-card pv-tier--hi"><span class="pv-badge">Recommended</span><h3>Growth</h3><div class="pv-price">$650<span style="font-size:0.9rem">/mo</span></div><ul><li>Everything in Essentials</li><li>Quarterly planning</li><li>Priority support</li></ul></div>
      <div class="pv-card"><h3>Advisory</h3><div class="pv-price">Custom</div><ul><li>Everything in Growth</li><li>Fractional CFO</li><li>Board reporting</li></ul></div>
    </div>
  </div>
</section>

<section data-block="testimonials" class="pv-section">
  <div class="pv-wrap">
    <h2>What clients say</h2>
    <div class="pv-grid pv-grid--3" style="margin-top:32px">
      <div class="pv-card"><blockquote>They caught deductions our last firm missed for years.</blockquote><div class="pv-cite">— A. Rivera, Contractor</div></div>
      <div class="pv-card"><blockquote>Finally, accountants who explain things in plain English.</blockquote><div class="pv-cite">— J. Chen, Dentist</div></div>
      <div class="pv-card"><blockquote>Responsive, proactive, and genuinely on our side.</blockquote><div class="pv-cite">— M. Okafor, Founder</div></div>
    </div>
  </div>
</section>

<section data-block="cta-banner" class="pv-section">
  <div class="pv-wrap">
    <h2>Ready to get started?</h2>
    <a class="pv-btn" href="#">Book your free consultation</a>
  </div>
</section>

<section data-block="footer">
  <div class="pv-wrap">
    <strong>Your Firm, CPAs</strong>
    <p class="pv-muted" style="margin-top:8px">123 Main St · (555) 010-0100 · hello@yourfirm.com</p>
  </div>
</section>
`
