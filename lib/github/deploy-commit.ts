// The commit message the package push uses when it lands the assembled
// deliverable on the draft branch (see pushAssembledDeliverable in
// package-assembler.ts: "Deploy packaged content via admin (...)").
export const DEPLOY_COMMIT_PREFIX = 'Deploy packaged content'

// True when any of the given draft commit messages is a deploy-content commit.
// The publish confirmation checks this across ALL commits that draft is ahead of
// main by — NOT just HEAD — because the publish pipeline stacks automated
// follow-up commits on top of the deploy commit within ~1s (site-settings sync
// pushes "Set siteUrl…"/"Set booking…", and later editor moves push
// "Move …"/"Add redirects"). So the deploy commit is almost never at HEAD after
// a successful publish; a HEAD-only check falsely times out.
export function containsDeployCommit(messages: Array<string | null | undefined>): boolean {
  return messages.some((m) => (m ?? '').startsWith(DEPLOY_COMMIT_PREFIX))
}
