-- ============================================================
-- 083: QA Desk — per-page automated QA between generation and human review
-- ============================================================
-- qa_status:     queued | running | done | error | skipped  (NULL = never queued / pre-QA rows)
-- qa_started_at: claim stamp (fencing token for the QA worker's write)
-- qa_review:     QaReview JSON (types/qa-review.ts)
-- qa_attempts:   QA runs attempted; capped in app code (QA_MAX_ATTEMPTS)
ALTER TABLE generated_pages
  ADD COLUMN IF NOT EXISTS qa_status text
    CHECK (qa_status IS NULL OR qa_status IN ('queued','running','done','error','skipped')),
  ADD COLUMN IF NOT EXISTS qa_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS qa_review jsonb,
  ADD COLUMN IF NOT EXISTS qa_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS generated_pages_qa_status_idx
  ON generated_pages (qa_status) WHERE qa_status IN ('queued','running');
