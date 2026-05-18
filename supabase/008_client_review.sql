ALTER TABLE generated_pages
  ADD COLUMN needs_client_review boolean NOT NULL DEFAULT false,
  ADD COLUMN client_approved_content boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN generated_pages.needs_client_review IS
  'Admin flag: when true, this page is included in the client review URL and the deliverable is blocked until the client approves.';

COMMENT ON COLUMN generated_pages.client_approved_content IS
  'Set true by the client via /review/[contentJobId]/. Required for the deliverable when needs_client_review is true.';
