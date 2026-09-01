# WordPress blog-sync bridge

A **one-way, opt-in** bridge that lets self-hosted WordPress (Divi) sites pull
published blog/resource posts from a client's git repo during the transition
period, while blogs are still authored and edited inside CountingFive.

It is deliberately **isolated and removable** — the sibling of the throwaway Divi
export bridge (`lib/content/divi/`). It is **not** wired into the content/publish
workflow, phase pipeline, publish gates, cron config, or editor UI. It only adds:

- `lib/wordpress/` — feed builder + site registry + image proxy helpers
- `app/api/wp-feed/[site]/` — the feed route + authenticated image-proxy route
- `config/wordpress-sites.json` — the per-site registry (empty = nothing enabled)
- `wordpress-plugin/countingfive-blog-sync/` — the PHP plugin operators install

## How it works

```
WP plugin (WP-cron)  ──GET /api/wp-feed/{site}  (Bearer secret)──▶  this app
   parse JSON posts                                                  reads content/posts/*.md
   upsert wp_posts by slug (publish)                                 from git `main` (GitHub App)
   sideload hero via /api/wp-feed/{site}/asset (Bearer) ◀────────────  streams private repo bytes
   posts missing from feed → set draft (never delete)
```

The app holds **all** GitHub credentials and serves clean JSON + proxied image
bytes. WordPress holds only a feed URL + a per-site bearer secret — never a
GitHub token. The repos are private, so hero images are emitted as authenticated
proxy URLs (`requires_auth: true`) that the plugin fetches with the bearer.

## Enabling a site

1. Add an entry to `config/wordpress-sites.json`:
   ```json
   {
     "acmetax": {
       "github_repo": "acmetax-site",
       "enabled": true,
       "secret_env": "WP_FEED_SECRET_ACMETAX"
     }
   }
   ```
   `github_repo` accepts `name` or `owner/name` (same as `content_jobs.github_repo`).
2. Set the named secret env var to a random 32-byte hex string (Vercel + `.env.local`):
   `WP_FEED_SECRET_ACMETAX=<openssl rand -hex 32>`
3. Install the `countingfive-blog-sync` plugin on the WordPress site and enter the
   feed URL (`https://<app-host>/api/wp-feed/acmetax`) + the same secret.

## Disabling

- **Per-site:** set `"enabled": false` in the JSON, or unset the secret env var.
  The feed then returns 404/401 and the plugin **no-ops** (it never drafts posts
  on a non-200 response), so nothing is destroyed.

## Full removal (one move)

```
rm -rf lib/wordpress
rm -rf app/api/wp-feed
rm -rf wordpress-plugin/countingfive-blog-sync
rm config/wordpress-sites.json
# drop any WP_FEED_SECRET_* env vars + the .env.example block
npx tsc --noEmit   # clean compile confirms nothing else depended on it
```

## Scope / limitations (v1)

- **Posts only** (`content/posts/*.md`). Pages, nav, and client-center are out of
  scope (handled natively or by the Divi bridge).
- **One-way**: git is the source of truth; edits made inside WordPress are
  overwritten on the next sync.
- **Hero image only**: current generator output has no inline body images. If
  inline `![]()` images referencing repo assets are ever added, extend
  `markdownToHtml` (module-local copy) and populate `inline_images`.
- `github_repo` is duplicated from Supabase into the JSON (intentional, for
  isolation) — keep it in sync if a repo is renamed.
