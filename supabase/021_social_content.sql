-- ============================================================
-- CountingFive Onboarding — social post suggestions per resource
-- Run this entire file in Supabase → SQL Editor
-- ============================================================
-- Each drafted blog post can carry suggested LinkedIn/Twitter/Instagram
-- copy, stored repo-first at content/social/{slug}.md on the draft branch.
-- social_path records where it landed so the admin panel knows the file
-- exists without a GitHub round-trip per poll.
-- ============================================================

ALTER TABLE resource_ideas ADD COLUMN social_path text DEFAULT NULL;

-- token_usage.stage — admit the social-generation stage
ALTER TABLE token_usage DROP CONSTRAINT token_usage_stage_check;
ALTER TABLE token_usage ADD CONSTRAINT token_usage_stage_check
  CHECK (stage IN ('keyword', 'outline', 'content', 'idea', 'resource', 'social'));
