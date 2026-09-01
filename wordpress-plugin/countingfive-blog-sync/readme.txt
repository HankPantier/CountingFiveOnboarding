=== CountingFive Blog Sync ===
Contributors: countingfive
Requires at least: 5.8
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

One-way pull of published blog posts from a CountingFive feed into WordPress.

== Description ==

During the transition period, blog/resource content is authored and edited inside
CountingFive and published to a client's git repo. This plugin lets a self-hosted
WordPress (Divi) site PULL those published posts in on a schedule.

* One-way: CountingFive is the source of truth. Editing a synced post inside
  WordPress is overwritten on the next sync.
* Matches posts by slug. New/updated posts are published. Posts that disappear
  from the feed are set to DRAFT (never deleted).
* Uploads the hero image into the media library and sets it as the featured image.
* Holds NO GitHub credentials — only the feed URL and a shared bearer secret.

== Installation ==

1. Copy the `countingfive-blog-sync` folder into `wp-content/plugins/`.
2. Activate "CountingFive Blog Sync" in Plugins.
3. Go to Settings → CF Blog Sync and enter:
   * Feed URL — e.g. https://app.countingfive.example/api/wp-feed/your-site
   * Shared secret — the bearer token CountingFive configured for this site
   * Sync interval — how often WP-cron pulls (default hourly)
   * Enabled — check to run scheduled syncs
4. Click "Sync now" to run an immediate pass and verify.

== Behavior notes ==

* If the feed returns anything other than HTTP 200 (wrong secret, disabled site,
  server error), the plugin makes NO changes — it will not draft posts on a
  transient failure.
* Post HTML from the feed uses only tags within WordPress's `wp_kses_post`
  allowlist (headings, paragraphs, lists, links, bold/italic, code).
* SEO meta title/description are written for both Yoast and Rank Math; use the
  `cf_blog_sync_seo_meta_keys` filter to map to another SEO plugin.

== Disabling / removal ==

* Pause: uncheck "Enabled" (settings are retained).
* Remove: deactivate + delete the plugin. Synced posts remain in WordPress in
  whatever state they were last in. Post meta `_cf_synced`, `_cf_source_slug`,
  and `_cf_hero_hash` are left in place.

== Changelog ==

= 1.0.0 =
* Initial release.
