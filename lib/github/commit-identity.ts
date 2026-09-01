// Fallback identity for git commits when no admin name/email is available.
// revaltus.com is the registered sending domain (RESEND_FROM_EMAIL); this address
// is only stamped as a git-commit author and never receives mail.
export const DEFAULT_COMMIT_AUTHOR = {
  name: 'Revaltus Admin',
  email: 'admin@revaltus.com',
} as const
