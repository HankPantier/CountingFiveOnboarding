// Client-safe vocabulary of the Design Studio revision chat (P5): limits, the
// tool outputs the UI renders, and the chat's UIMessage type.
import type { UIMessage } from 'ai'
import type { RunScreenshot } from './run-types'

export const CHAT_TEXT_MAX = 4000
export const MAX_ATTACHMENTS_PER_MESSAGE = 3
export const MAX_PAGE_PATH_LENGTH = 200
export const PREVIEWS_PER_TURN = 2
// Attachment images reach the model only on the last N user turns (spec Cost).
export const IMAGE_USER_TURNS = 2
export const HISTORY_LOAD_LIMIT = 60
export const HISTORY_MAX_MESSAGES = 16
export const HISTORY_MAX_CHARS = 48_000
// The route's maxDuration is 300 s; a turn plans within 270 s.
export const TURN_BUDGET_MS = 270_000
export const CHAT_MAX_STEPS = 12
// Adaptive-thinking tokens count against this cap — leave headroom for CSS.
export const CHAT_MAX_OUTPUT_TOKENS = 16_000
export const DEFAULT_CHAT_PAGE = '/'

export type ChatAttachmentDto = { id: string; url: string | null; width?: number; height?: number }

// A stored preview screenshot; `url` is a short-lived signed URL, present only
// in the live stream and in GET history (never persisted).
export type PreviewShot = RunScreenshot & { url?: string | null }

export type RenderPreviewOutput =
  | { ok: true; previewNo: number; page: string; shots: PreviewShot[]; gateFailures: string[]; warnings: string[]; measured: boolean }
  | { ok: false; error: string }

export type CommitOutput =
  | { ok: true; versionId: string; versionNo: number; changedPaths: string[]; warnings: string[] }
  | { ok: true; unchanged: true }
  | { ok: false; error: string; failures?: string[] }

// The end-of-turn auto-commit outcome, streamed (and stored) as a
// `data-design-commit` part.
export type DesignCommitData =
  | { status: 'committed'; versionId: string; versionNo: number; changedPaths: string[]; warnings: string[]; auto: true }
  | { status: 'blocked'; error: string; failures: string[] }

export type DesignChatMetadata = { attachments?: ChatAttachmentDto[]; versionId?: string | null; createdAt?: string }
export type DesignChatMessage = UIMessage<DesignChatMetadata, { 'design-commit': DesignCommitData }>

export interface DesignChatRequestBody {
  text: string
  attachmentIds?: string[]
  page?: string
}
