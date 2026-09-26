// Server-only (workspace → sanitizer/lightningcss; preview → renderer). ONE
// design-chat turn = one request:
//   prepareChatTurn — validate + load everything BEFORE streaming (typed 4xx):
//     the draft theme (409s), this turn's attachments (400 if missing), the
//     capability tier, the brand brief inputs, the persisted history; it builds
//     the working copy + both prompt blocks and only THEN saves the user
//     message (a failure before that stores nothing).
//   streamChatTurn — the Sonnet tool loop (chatProviderOptions('medium'),
//     cached static system block + per-turn block; bounded by steps AND by the
//     turn deadline — see CHAT_WRAP_UP_MS), then — once every queued
//     tool execute has settled — the end-of-turn auto-commit of anything still
//     staged (streamed as data-design-commit; discarded if the stream failed),
//     then the assistant message is persisted. Usage is summed per step and
//     recorded once in a finally, so a failed stream still records its spend.
// Staged edits never outlive the request (P5 R1 — no migration). The stream
// keeps running if the admin closes the tab (consumeSseStream), so a turn
// always ends committed or reported.
//
// The model's history carries no signed URLs (null preview signer) and no
// base64 except this turn's (and the previous user turn's) attachments; the
// persisted assistant parts go through storedParts (no signed URLs, no base64).
import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { anthropic } from '@ai-sdk/anthropic'
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logAndFormatAiStreamError } from '@/lib/ai/ai-error'
import { CACHE_EPHEMERAL, extractCacheUsage } from '@/lib/content/cache-control'
import { INTERACTIVE_CHAT_MODEL, chatProviderOptions } from '@/lib/content/generation-tuning'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { readOptional } from './apply-bundle'
import { DESIGN_MD_PATH } from './brief/brand'
import { buildChatSystemStatic, buildChatTurnContext } from './brief/chat-prompt'
import { bundleFromRepoFiles, type RepoThemeFiles } from './bundle-files'
import { readDesignCapabilities } from './capabilities-read'
import { commitWorkspace, finishTurnCommit, type CommitVersionFn } from './chat-commit'
import {
  historyForModel,
  imageTurnIds,
  lastTurnNote,
  messageText,
  rowToChatMessage,
  storedParts,
  withAttachmentImages,
  type ChatRequest,
} from './chat-history'
import { insertChatMessage, listChatMessages } from './chat-store'
import { CHAT_COMMIT_RESERVE_MS } from './chat-preview'
import { chatPreviewDeps, createDesignChatToolset, type ChatToolDeps } from './chat-tools'
import { CHAT_MAX_OUTPUT_TOKENS, CHAT_MAX_STEPS, DEFAULT_CHAT_PAGE, TURN_BUDGET_MS, type DesignChatMessage } from './chat-types'
import { ChatWorkspace } from './chat-workspace'
import { commitDesignVersion, type CommitTarget } from './commit-version'
import { composedThemeFromFiles, type ComposedTheme } from './composed-theme'
import { computeDrift, toBlobMap } from './drift'
import { isPlainObject } from './input-validation'
import { firmNameFrom } from './run-gather'
import { attachmentStoragePath, downloadDesignImage } from './storage'
import { latestVersion, readSessionSchema } from './store'
import type { ThemeBlobShas } from './studio-types'
import { readDraftThemeSnapshot, themeTextsFromSnapshot } from './theme-snapshot'

type Db = SupabaseClient<Database>
type InlineImage = { mediaType: string; base64: string }

export type ChatActor = { sessionId: string; jobId: string; githubRepo: string; adminId: string; adminEmail?: string; adminName?: string }

export type PreparedTurn = {
  assistantId: string
  userMessage: DesignChatMessage
  history: DesignChatMessage[]
  workspace: ChatWorkspace
  staticSystem: string
  turnContext: string
  page: string
  target: CommitTarget
  baselineTheme: ComposedTheme
  baselineShas: ThemeBlobShas
  startedAt: number
}

export type TurnIo = {
  model: LanguageModel
  commitVersion: CommitVersionFn
  preview: ChatToolDeps['preview']
  // PF1: the exact per-page time check (baseline cached or not) — chatPreviewDeps.
  previewFits: ChatToolDeps['previewFits']
  persistAssistant: (row: { id: string; content: string; parts: unknown[]; versionId: string | null }) => Promise<void>
  recordUsage: (usage: LanguageModelUsage) => Promise<void>
  // The turn's clock (tests inject one); defaults to Date.now.
  now?: () => number
}

// The model loop's time limits, against the turn deadline (TURN_BUDGET_MS after
// the request started; the route's maxDuration leaves 60 s past it):
//   - no further model step starts once less than CHAT_COMMIT_RESERVE_MS is
//     left (stopWhen), so drain → the auto-commit → persistence → usage always
//     get their reserve;
//   - from CHAT_WRAP_UP_MS before that, steps are offered no tools, so the
//     model's last step is its reply instead of a half-finished plan;
//   - a step still running AT the deadline is aborted (the stream then counts
//     as failed and staged edits are discarded, never half-committed).
export const CHAT_WRAP_UP_MS = 60_000
export const CHAT_TURN_TIMEOUT_ERROR = 'The reply ran out of time, so it was stopped.'
const CONVERSION_FAILED_ERROR = 'The conversation could not be prepared for the assistant — nothing was changed. Try again, or clear the chat if it keeps happening.'

export function chatStepTools(now: () => number, turnDeadlineAt: number): { activeTools: [] } | undefined {
  return now() >= turnDeadlineAt - CHAT_COMMIT_RESERVE_MS - CHAT_WRAP_UP_MS ? { activeTools: [] } : undefined
}

const MISSING_ATTACHMENT = 'An attached image could not be found — attach it again.'

async function inlineImage(db: Db, sessionId: string, attachmentId: string): Promise<InlineImage> {
  const bytes = await downloadDesignImage(db, attachmentStoragePath(sessionId, attachmentId))
  return { mediaType: 'image/webp', base64: Buffer.from(bytes).toString('base64') }
}

export async function prepareChatTurn(
  db: Db,
  actor: ChatActor,
  request: ChatRequest,
  startedAt: number
): Promise<{ ok: true; turn: PreparedTurn } | { ok: false; status: 400 | 409; error: string }> {
  const snapshot = await readDraftThemeSnapshot(actor.githubRepo)
  const draft = themeTextsFromSnapshot(snapshot)
  if (!draft.ok) return { ok: false, status: 409, error: draft.error }

  // The working copy's base: the SAME turn-start snapshot its shas guard.
  const draftFiles: RepoThemeFiles = { brandText: draft.files.brandText, designText: draft.files.designText, overridesCss: draft.files.overridesCss }
  const latest = await latestVersion(db, actor.sessionId)
  const latestName = latest && isPlainObject(latest.bundle) && typeof latest.bundle.name === 'string' ? latest.bundle.name : null
  const current = bundleFromRepoFiles(draftFiles, { name: latestName ?? 'Current design', source: 'chat' })
  if (!current.ok) return { ok: false, status: 409, error: `The current design can’t be read: ${current.errors.join(' ')}`.slice(0, 500) }

  // This turn's attachments must exist in THIS session's folder (the path is
  // built from the gated session id, so a foreign id can't reach anything).
  const currentImages: InlineImage[] = []
  for (const id of request.attachmentIds) {
    try {
      currentImages.push(await inlineImage(db, actor.sessionId, id))
    } catch {
      return { ok: false, status: 400, error: MISSING_ATTACHMENT }
    }
  }

  const [caps, schema, designMd, rows] = await Promise.all([
    readDesignCapabilities(actor.githubRepo),
    readSessionSchema(db, actor.sessionId),
    readOptional(actor.githubRepo, DESIGN_MD_PATH),
    listChatMessages(db, actor.sessionId),
  ])
  // Null signers: the model's context never carries a signed URL.
  const prior = rows.map((r) => rowToChatMessage(r, { preview: () => null, attachment: () => null }))

  // Everything the turn needs is built BEFORE the user message is stored, so
  // a failure here can't leave a user message with no reply. The row id is
  // generated here and written with the insert.
  const userId = randomUUID()
  const userMessage: DesignChatMessage = {
    id: userId,
    role: 'user',
    parts: [{ type: 'text', text: request.text }],
    metadata: { attachments: request.attachmentIds.map((id) => ({ id, url: null })) },
  }

  // Images only for the image turns of the TRIMMED history (the current turn
  // is always one of them).
  const trimmed = historyForModel([...prior, userMessage])
  const images: Record<string, InlineImage[]> = {}
  for (const id of imageTurnIds(trimmed)) {
    if (id === userMessage.id) {
      if (currentImages.length > 0) images[id] = currentImages
      continue
    }
    const atts = trimmed.find((msg) => msg.id === id)?.metadata?.attachments ?? []
    const loaded: InlineImage[] = []
    for (const a of atts) {
      try {
        loaded.push(await inlineImage(db, actor.sessionId, a.id))
      } catch {
        // Gone (e.g. history cleared elsewhere) — the text note covers it.
      }
    }
    if (loaded.length > 0) images[id] = loaded
  }

  const drift = computeDrift(snapshot.shas, latest ? { versionNo: latest.version_no, appliedBlobs: toBlobMap(latest.applied_blobs) } : null)
  const page = request.page ?? DEFAULT_CHAT_PAGE
  const turn: PreparedTurn = {
    assistantId: randomUUID(),
    userMessage,
    history: withAttachmentImages(trimmed, images),
    workspace: new ChatWorkspace({ current: current.bundle, draftFiles, draftShas: snapshot.shas, caps, model: INTERACTIVE_CHAT_MODEL }),
    staticSystem: buildChatSystemStatic({ firmName: firmNameFrom(draft.files.brandText), schema, designMd: designMd?.content ?? null, caps }),
    turnContext: buildChatTurnContext({ bundle: current.bundle, latestVersionNo: latest?.version_no ?? null, drift: drift.status, page, lastTurnNote: lastTurnNote(prior) }),
    page,
    target: actor,
    baselineTheme: composedThemeFromFiles(draft.files),
    baselineShas: snapshot.shas,
    startedAt,
  }

  await insertChatMessage(db, {
    id: userId,
    sessionId: actor.sessionId,
    role: 'user',
    content: request.text,
    parts: [{ type: 'text', text: request.text }],
    attachmentIds: request.attachmentIds,
    createdBy: actor.adminId,
  })
  return { ok: true, turn }
}

function addCount(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0)
}

// The turn's spend so far (ai's own adder is not exported).
function addUsage(a: LanguageModelUsage, b: LanguageModelUsage): LanguageModelUsage {
  return {
    inputTokens: addCount(a.inputTokens, b.inputTokens),
    inputTokenDetails: {
      noCacheTokens: addCount(a.inputTokenDetails?.noCacheTokens, b.inputTokenDetails?.noCacheTokens),
      cacheReadTokens: addCount(a.inputTokenDetails?.cacheReadTokens, b.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: addCount(a.inputTokenDetails?.cacheWriteTokens, b.inputTokenDetails?.cacheWriteTokens),
    },
    outputTokens: addCount(a.outputTokens, b.outputTokens),
    outputTokenDetails: {
      textTokens: addCount(a.outputTokenDetails?.textTokens, b.outputTokenDetails?.textTokens),
      reasoningTokens: addCount(a.outputTokenDetails?.reasoningTokens, b.outputTokenDetails?.reasoningTokens),
    },
    totalTokens: addCount(a.totalTokens, b.totalTokens),
  }
}

export async function streamChatTurn(turn: PreparedTurn, io: TurnIo): Promise<Response> {
  const ws = turn.workspace
  const now = io.now ?? Date.now
  const turnDeadlineAt = turn.startedAt + TURN_BUDGET_MS
  const commit = (summary: string) => commitWorkspace(ws, { summary, target: turn.target, commitVersion: io.commitVersion })
  const { tools, drain } = createDesignChatToolset(ws, {
    defaultPage: turn.page,
    timeLeftMs: () => turnDeadlineAt - now(),
    preview: io.preview,
    previewFits: io.previewFits,
    commit,
  })
  // The SAME tools object converts the history, so earlier previews go
  // through toModelOutput (text only). The user message is already stored: if
  // the conversion fails, store a short reply too so it never stands alone.
  let messages: ModelMessage[]
  try {
    messages = await convertToModelMessages(turn.history, { tools, ignoreIncompleteToolCalls: true })
  } catch (err) {
    console.error('[design-chat] history conversion failed', err)
    try {
      await io.persistAssistant({ id: turn.assistantId, content: CONVERSION_FAILED_ERROR, parts: [{ type: 'text', text: CONVERSION_FAILED_ERROR }], versionId: null })
    } catch (persistErr) {
      console.error('[design-chat] the error reply could not be saved', persistErr)
    }
    return NextResponse.json({ error: CONVERSION_FAILED_ERROR }, { status: 500 })
  }
  let streamFailed = false
  let usage: LanguageModelUsage | null = null
  // The hard stop: a model step still running at the deadline is aborted.
  const deadline = new AbortController()
  const deadlineTimer = setTimeout(() => deadline.abort(new Error(CHAT_TURN_TIMEOUT_ERROR)), Math.max(0, turnDeadlineAt - now()))

  const stream = createUIMessageStream<DesignChatMessage>({
    originalMessages: [turn.userMessage],
    generateId: () => turn.assistantId,
    execute: async ({ writer }) => {
      try {
        const result = streamText({
          model: io.model,
          providerOptions: chatProviderOptions('medium'),
          system: [
            { role: 'system', content: turn.staticSystem, providerOptions: CACHE_EPHEMERAL },
            { role: 'system', content: turn.turnContext },
          ],
          messages,
          tools,
          maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
          stopWhen: [stepCountIs(CHAT_MAX_STEPS), () => now() >= turnDeadlineAt - CHAT_COMMIT_RESERVE_MS],
          prepareStep: () => chatStepTools(now, turnDeadlineAt),
          abortSignal: deadline.signal,
          onError: () => {
            streamFailed = true
          },
          onStepFinish: (step) => {
            usage = usage ? addUsage(usage, step.usage) : step.usage
          },
        })
        // Forward chunk by chunk (not writer.merge) so the commit part below is
        // guaranteed to follow the model's last chunk.
        for await (const chunk of result.toUIMessageStream<DesignChatMessage>({
          sendFinish: false,
          sendReasoning: false,
          generateMessageId: () => turn.assistantId,
          onError: (error) => logAndFormatAiStreamError('design-chat', error),
        })) {
          if (chunk.type === 'error' || chunk.type === 'abort') streamFailed = true
          writer.write(chunk)
        }
      } catch (err) {
        streamFailed = true
        writer.write({ type: 'error', errorText: logAndFormatAiStreamError('design-chat', err) })
      } finally {
        clearTimeout(deadlineTimer)
        const spent = usage
        if (spent) {
          try {
            await io.recordUsage(spent)
          } catch (err) {
            console.warn('[design-chat] usage not recorded:', err)
          }
        }
      }
      // A render or commit may still be running after the stream ended (it
      // failed or was aborted mid-tool) — let it settle before deciding.
      await drain()
      const outcome = await finishTurnCommit(ws, commit, streamFailed)
      if (outcome.status !== 'none') writer.write({ type: 'data-design-commit', data: outcome })
      writer.write({ type: 'finish' })
    },
    onError: (error) => logAndFormatAiStreamError('design-chat', error),
    onFinish: async ({ responseMessage }) => {
      try {
        await io.persistAssistant({
          id: turn.assistantId,
          content: messageText(responseMessage),
          parts: storedParts(responseMessage.parts),
          versionId: ws.lastVersionId(),
        })
      } catch (err) {
        console.error('[design-chat] the assistant message could not be saved', err)
      }
    },
  })
  return createUIMessageStreamResponse({ stream, consumeSseStream: consumeStream })
}

export async function runDesignChatTurn(db: Db, actor: ChatActor, request: ChatRequest, startedAt: number): Promise<Response> {
  const prepared = await prepareChatTurn(db, actor, request, startedAt)
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: prepared.status })
  const turn = prepared.turn
  // The preview turn id is the server-generated assistant message id; the
  // baseline is the turn-start draft (a mid-turn commit must not move it).
  const previewDeps = chatPreviewDeps({
    db,
    target: { sessionId: actor.sessionId, jobId: actor.jobId, githubRepo: actor.githubRepo },
    turnId: turn.assistantId,
    baselineTheme: turn.baselineTheme,
    baselineShas: turn.baselineShas,
    turnDeadlineAt: turn.startedAt + TURN_BUDGET_MS,
  })
  return streamChatTurn(turn, {
    model: anthropic(INTERACTIVE_CHAT_MODEL),
    commitVersion: (args) => commitDesignVersion(db, args),
    preview: previewDeps.preview,
    previewFits: previewDeps.previewFits,
    persistAssistant: async (row) => {
      await insertChatMessage(db, {
        id: row.id,
        sessionId: actor.sessionId,
        role: 'assistant',
        content: row.content,
        parts: row.parts,
        versionId: row.versionId,
        createdBy: actor.adminId,
      })
      const { error } = await db.from('sessions').update({ last_activity_at: new Date().toISOString() }).eq('id', actor.sessionId)
      if (error) console.warn('[design-chat] last_activity_at not updated:', error.message)
    },
    recordUsage: (usage) =>
      recordTokenUsage({
        task: 'content',
        sessionId: actor.sessionId,
        createdBy: actor.adminId,
        stage: 'design_chat',
        model: INTERACTIVE_CHAT_MODEL,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...extractCacheUsage(usage),
      }),
  })
}
