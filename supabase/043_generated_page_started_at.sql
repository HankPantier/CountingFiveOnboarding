-- 043: when a page actually started generating (set on the atomic 'running'
-- claim). The stuck-job sweep previously judged "stuck" by created_at (set at
-- sitemap-confirm), so on long jobs it kept resetting healthy in-flight pages to
-- 'error'. Keying the sweep off this timestamp fixes those false positives.
ALTER TABLE generated_pages ADD COLUMN IF NOT EXISTS generation_started_at timestamptz;
