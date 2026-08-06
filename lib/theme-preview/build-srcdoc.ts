import { PREVIEW_BASE_CSS, SAMPLE_BLOCKS_HTML } from './sample-blocks'

// Assemble the self-contained HTML document for the Theme Studio preview iframe.
// Cascade mirrors the real client site: base (Ink & Clay foundation) → the
// client's generated theme.css → design-overrides.css. Rendered via
// <iframe srcDoc> so the client's global [data-block] selectors are fully
// isolated from the admin UI.
//
// theme.css uses a Tailwind v4 `@theme { }` block AND a duplicate `:root { }`;
// with no Tailwind in the iframe the `@theme` at-rule is simply ignored and the
// `:root` copy supplies every token — which is exactly why the template
// duplicates them. So the preview needs no Tailwind build step.
// Neutralize a stray `</style>` in injected CSS so it can never close the
// <style> element and break into markup. The preview iframe is already fully
// sandboxed (sandbox="", no scripts), but design-overrides.css can be authored
// outside our validated tool (hand-edited / pasted from Claude.ai Design), so we
// belt-and-suspenders it here too. The escaped form is invalid CSS and ignored.
function cssSafe(css: string): string {
  return css.replace(/<\/(style)/gi, '<\\/$1')
}

export function buildPreviewSrcDoc(args: { themeCss: string; overridesCss: string }): string {
  const themeCss = cssSafe(args.themeCss)
  const overridesCss = cssSafe(args.overridesCss)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;700&family=Fraunces:ital,wght@0,400;1,400;1,500&display=swap" rel="stylesheet" />
<style>${PREVIEW_BASE_CSS}</style>
<style>${themeCss}</style>
<style>${overridesCss}</style>
</head>
<body>
${SAMPLE_BLOCKS_HTML}
</body>
</html>`
}
