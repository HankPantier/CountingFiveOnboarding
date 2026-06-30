-- 042: per-page generation error detail for the Content Generation phase.
-- The admin UI shows a "N errors" count but the failure reason was only logged
-- server-side and discarded. This nullable column persists the message so the
-- admin can expand the count, see why each page failed, and retry it.
ALTER TABLE generated_pages ADD COLUMN IF NOT EXISTS generation_error text;
