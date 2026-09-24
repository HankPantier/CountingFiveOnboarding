import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Enables forbidden()/unauthorized() so section layouts can return a real
  // HTTP 403 for authenticated-but-unauthorized users (see lib/auth/page-guards).
  experimental: { authInterrupts: true },
  // lightningcss ships native .node bindings — keep it out of the server
  // bundle (require() it at runtime) instead of letting Turbopack try to
  // bundle the binary. Used by lib/design/css-sanitizer.ts (server-only).
  serverExternalPackages: ['lightningcss', '@sparticuz/chromium', 'playwright-core'],
  // lightningcss picks its native binding at runtime with a computed
  // require() (`lightningcss-${platform}-${arch}`), which file tracing can't
  // follow — so the Linux binary Vercel needs would be missing from the
  // function bundle. Force-include it for the one route that loads the
  // sanitizer. Keys are picomatch globs matched against the route path, so
  // the dynamic segment's brackets must be escaped to match literally.
  // On Linux, lightningcss also require()s detect-libc (to pick gnu vs musl)
  // before loading the binary — tracing misses that branch on a macOS build.
  outputFileTracingIncludes: {
    '/api/edit/\\[id\\]/theme/chat': [
      './node_modules/lightningcss/**',
      './node_modules/lightningcss-linux-x64-gnu/**',
      './node_modules/detect-libc/**',
    ],
    // @sparticuz/chromium ships its brotli-compressed Chromium in bin/, which it
    // loads by path at runtime — tracing can't see it, so force-include it.
    // playwright-core's own coreBundle.js also requires browsers.json (and the
    // rest of its lib/) dynamically by path — untraced, that surfaces on
    // Vercel as "Cannot find module '.../node_modules/playwright-core/browsers.json'"
    // at cold start, which crashes the whole route module (an untyped 500).
    '/api/edit/\\[id\\]/design/render': ['./node_modules/@sparticuz/chromium/bin/**', './node_modules/playwright-core/**'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
};

export default nextConfig;
