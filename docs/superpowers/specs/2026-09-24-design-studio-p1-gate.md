# Design Studio P1: Renderer Go/No-Go Gate

**Verdict: GO.** The warm p95 `renderMs` was **2350 ms**, under the 5000 ms gate. Every call succeeded: 13 of 13 returned 200, with no out-of-memory errors, no 5xx, and no renderer warnings in the logs.

- **Date:** 2026-09-24
- **Deployment:** Vercel preview `counting-five-admin-amsm57x5v-hankpantiers-projects.vercel.app`, branch `feat/design-studio-p1`, commit `e0dcd3f`, Node 24, Fluid compute
- **Target:** bblcpa (session `7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184`), rendered against its live shell (`https://bblcpa.vercel.app/`) with the draft theme applied
- **Protocol:** 1 cold render (desktop `/`), then 12 warm renders run one after another, alternating desktop (`/services`, `/`) and mobile `/`

## Results

`renderMs` includes the browser launch. For warm renders the launch was 0–1 ms, so `renderMs` is effectively the render time alone. `totalMs` adds the shell fetch, the GitHub theme reads, WebP encoding, storage and signing. It is recorded here but is not part of the gate.

| # | Viewport | Path | Status | launchMs | renderMs | totalMs | Shots |
|---|---|---|---|---|---|---|---|
| 1 (cold) | desktop | / | 200 | 4040 | 6923 | 9723 | fold 1440×900 + 3 block crops |
| 2 | desktop | /services | 200 | 0 | 2271 | 4209 | fold + 3 crops |
| 3 | mobile | / | 200 | 0 | 1312 | 4540 | fold + next (725×1568 each) |
| 4 | desktop | / | 200 | 0 | 2099 | 8614 | fold + 3 crops |
| 5 | mobile | / | 200 | 0 | 1115 | 3543 | fold + next |
| 6 | desktop | /services | 200 | 1 | 2135 | 4550 | fold + 3 crops |
| 7 | mobile | / | 200 | 0 | 1361 | 5372 | fold + next |
| 8–13 | alternating | | 200 ×6 | 0 | ≤ 2350 | ≤ 8614 | as above |

- **Warm renderMs:** p50 1361 ms, p95 2350 ms, max 2350 ms.
- **Warm totalMs:** p50 4209 ms, p95 8614 ms. The client-observed p95 was 9185 ms.
- **Cold steps** (ms):

  | Step | ms |
  |---|---|
  | launch | 4040 |
  | emulate | 2 |
  | setContent | 522 |
  | settle | 501 |
  | fonts | 5 |
  | fold | 433 |
  | crops | 656 / 301 / 446 |
  | reset | 16 |
- **Warm steps:** setContent 194 ms, settle 500 ms, fold 455 ms, and crops of 260–540 ms each.
- **Blocked requests:** exactly 1 per render. This is the page's single off-origin request, blocked by the allowlist or the CSP.
- **Mobile fold:** 780×1688 at DPR 2, stored at 725×1568 after the 1568 px long-edge cap.
- **Peak memory:** not shown per function on Active CPU billing. There were no OOM or runtime-exit events.

## Failures found and fixed on the way to GO

1. **Missing `browsers.json` in the deploy (untraced).** Run 1 on `b2d8db5` failed with an untyped 500 on the first call.
   - **Cause:** `playwright-core` loads `browsers.json` with a dynamic require, so it wasn't traced into the build.
   - **Fix (`8a45bcd`):**
     - Force-include `playwright-core/**` for the render route.
     - Lazy-load the renderer, so a module that fails to load returns a typed 503.
2. **Renders hanging until Vercel's 120 s kill.** This happened on runs 2–3 (`8a45bcd`, `e97c923`).
   - **Step timings** (added in `a333981`) located the hang at `context.newPage()` on a warm browser.
   - **Pattern:** it alternated strictly. The 1st render on a fresh browser succeeded (warm ≈ 1.9 s), and the 2nd hung.
   - **Cause:** `@sparticuz/chromium` requires `--single-process` on Vercel, and creating and closing a BrowserContext and page per render wedges `newPage()` in that mode.
   - **Fix (`e0dcd3f`):**
     - Reuse **one context and one page per browser**.
     - Emulate each render's viewport and DPR over CDP.
     - Install one route handler that reads per-render state.
     - Add a FIFO render mutex.
   - Also added along the way:
     - a 45 s render deadline returning `RenderTimeoutError`/504;
     - bounded evaluates and screenshots;
     - identity-scoped browser recycling on failure (`70540dc`).

## Notes

- **Per-function memory is ignored.** `vercel.json` sets `memory: 3009` for the render route, but Vercel ignores per-function memory on Active CPU billing and warns about it in the build log. The project-level memory applies instead, and it proved sufficient. The setting can be removed.
- **Known limits carried into P2+:**
  - Renders on one instance are serialized, so a burst will queue. A 10 s minimum-budget guard follows in the final fix round.
  - Off-origin hotlinked images render blank, by design of the allowlist.
  - Mobile uses `mobile: true` emulation, so pages without a viewport meta lay out 980 px wide.
