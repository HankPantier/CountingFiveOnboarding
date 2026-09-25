// Pure. The in-page measurement script the Design Studio renderer evaluates
// on the composed document at each viewport, after webfonts and before the
// fold screenshot. It runs over CDP (page.evaluate), which the page's own CSP
// (script-src 'none') does not apply to — the same path P1 already uses for
// document.fonts.ready. It is a plain JS STRING, never a function:
// page.evaluate(fn) serializes fn.toString(), and helpers a transpiler
// injects into TypeScript functions do not exist in the page.
//
// It only COLLECTS raw samples; every decision (contrast ratios, overflow,
// hidden blocks) is made in lib/design/metrics.ts so it is unit-tested
// without a browser. Bounded: ≤ 4000 elements scanned, ≤ 400 text samples,
// ≤ 80 blocks, ≤ 8 offenders. Empty computed values (jsdom) are read as the
// CSS initial value.
export const PAGE_METRICS_SCRIPT = String.raw`(() => {
  const MAX_SCAN = 4000, MAX_TEXT = 400, MAX_BLOCKS = 80, MAX_OFFENDERS = 8;
  const root = document.documentElement;
  const body = document.body;
  const vw = root.clientWidth;
  const scrollWidth = Math.max(root.scrollWidth || 0, body ? body.scrollWidth || 0 : 0);
  const sx = window.scrollX || 0, sy = window.scrollY || 0;
  const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
  const alphaOf = (c) => {
    if (!c || c === 'transparent') return 0;
    const slash = c.match(/\/\s*([\d.]+)(%?)\s*\)$/);
    if (slash) return slash[2] ? num(slash[1], 100) / 100 : num(slash[1], 1);
    const rgba = c.match(/^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([\d.]+)\s*\)$/);
    return rgba ? num(rgba[1], 1) : 1;
  };
  const scopeOf = (el) => {
    const s = el.closest('[data-block],[data-component]');
    if (!s) return 'page';
    const b = s.getAttribute('data-block');
    return b ? 'block:' + b : 'component:' + s.getAttribute('data-component');
  };
  const counter = () => {
    const seen = new Map();
    return (el) => {
      const base = scopeOf(el) + ' ' + el.tagName.toLowerCase();
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      return base + '#' + n;
    };
  };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'OPTION', 'HEAD', 'META', 'LINK', 'BR']);
  const all = body ? Array.from(body.querySelectorAll('*')).slice(0, MAX_SCAN) : [];

  const textKey = counter();
  const text = [];
  for (const el of all) {
    if (text.length >= MAX_TEXT) break;
    if (SKIP.has(el.tagName)) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.replace(/\s+/g, ' ').trim();
    if (own.length < 2) continue;
    const cs = getComputedStyle(el);
    if ((cs.display || 'block') === 'none' || (cs.visibility || 'visible') !== 'visible') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let opacity = 1, bgImage = false, bgDone = false;
    const bg = [];
    for (let a = el; a; a = a.parentElement) {
      const s = a === el ? cs : getComputedStyle(a);
      opacity *= num(s.opacity, 1);
      if (bgDone) continue;
      if ((s.backgroundImage || 'none') !== 'none') { bgImage = true; bgDone = true; continue; }
      const c = s.backgroundColor || 'transparent';
      const alpha = alphaOf(c);
      if (alpha > 0) { bg.push(c); if (alpha >= 1) bgDone = true; }
    }
    if (opacity < 0.1) continue;
    text.push({ key: textKey(el), text: own.slice(0, 40), color: cs.color || '', bg, bgImage, fontSizePx: num(cs.fontSize, 16), fontWeight: num(cs.fontWeight, 400), opacity });
  }

  const blockSeen = new Map();
  const blocks = [];
  for (const el of Array.from(document.querySelectorAll('[data-block]')).slice(0, MAX_BLOCKS)) {
    const id = el.getAttribute('data-block') || '?';
    const n = blockSeen.get(id) || 0;
    blockSeen.set(id, n + 1);
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    let opacity = 1;
    for (let a = el; a; a = a.parentElement) opacity *= num(getComputedStyle(a).opacity, 1);
    blocks.push({ key: 'block:' + id + '#' + n, display: cs.display || 'block', visibility: cs.visibility || 'visible', opacity, width: r.width, height: r.height, left: r.left + sx, right: r.right + sx, top: r.top + sy, bottom: r.bottom + sy });
  }

  const clippedOrFixed = (el) => {
    for (let a = el; a && a !== body && a !== root; a = a.parentElement) {
      const s = getComputedStyle(a);
      if ((s.position || 'static') === 'fixed') return true;
      if (a !== el && (s.overflowX || 'visible') !== 'visible') return true;
    }
    return false;
  };
  const offenderKey = counter();
  const offending = new Set();
  const offenders = [];
  for (const el of all) {
    if (offenders.length >= MAX_OFFENDERS) break;
    if (SKIP.has(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.right <= vw + 2) continue;
    if (el.parentElement && offending.has(el.parentElement)) { offending.add(el); continue; }
    if ((getComputedStyle(el).visibility || 'visible') !== 'visible' || clippedOrFixed(el)) continue;
    offending.add(el);
    offenders.push(offenderKey(el) + ' (' + Math.round(r.right) + 'px)');
  }

  return { viewportWidth: vw, scrollWidth, docHeight: root.scrollHeight || 0, offenders, text, blocks };
})()`
