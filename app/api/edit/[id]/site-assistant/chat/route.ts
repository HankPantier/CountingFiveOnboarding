import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { anthropic } from '@ai-sdk/anthropic'
import { after, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEditContext } from '../../_helpers'
import { safePath } from '../../_path'
import { readJsonBody } from '@/app/api/_json'
import { getCurrentUser } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import { trimMessages } from '@/lib/agent/trim-messages'
import { recordTokenUsage } from '@/lib/content/token-usage'
import { buildBrandVoiceBlock } from '@/lib/content/brand-voice'
import { normalizeSlug } from '../../create-page/_slug'
import { buildStarterPage, generateNewPage } from '@/lib/content/new-page-generator'
import { appendNavItem, retargetNavUrl, stripNavReference } from '@/lib/editor/nav-mutations'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import { contentPathToUrl, urlToContentPath } from '@/lib/editor/content-paths'
import { DestinationOccupiedError, relocateFile } from '@/lib/editor/relocate'
import { insertMbpSuggestion } from '@/lib/mbp/create-suggestion'
import {
  DRAFT_BRANCH,
  FileNotFoundError,
  StaleShaError,
  deleteFile,
  ensureDraftBranch,
  listTree,
  readFile,
  writeFile,
} from '@/lib/github/repo-files'
import type { NavItem, NavJson } from '@/types/nav-json'
import type { SessionSchema } from '@/types/session-schema'

export const runtime = 'nodejs'
// New-page content generation runs in an after() callback (outline + body +
// Pexels images) — give the same headroom as the create-page route.
export const maxDuration = 300

const NAV_PATH = 'content/nav.json'
const PAGE_ROOTS = ['content/pages/', 'content/posts/', 'content/drafts/pages/', 'content/drafts/posts/'] as const

function navContainsUrl(items: NavItem[], url: string): boolean {
  return items.some((i) => i.url === url || (i.children ? navContainsUrl(i.children, url) : false))
}

// A model-supplied content path must be traversal-safe AND under a page root.
function validPagePath(raw: string): string | null {
  const path = safePath(raw)
  if (!path || !path.endsWith('.md')) return null
  if (!PAGE_ROOTS.some((r) => path.startsWith(r))) return null
  return path
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  const { githubRepo, sessionId, jobId, adminEmail, adminName } = ctx

  // resolveEditContext admits assigned managers; site-structure editing (deletes
  // + content generation) is admin-only, mirroring Theme Studio.
  const user = await getCurrentUser()
  if (!user || !user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await readJsonBody<{ messages: UIMessage[] }>(req)
  if (body instanceof NextResponse) return body
  const { messages } = body
  const supabase = createServerClient()

  try {
    await ensureDraftBranch(githubRepo)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to prepare the draft branch' },
      { status: 500 }
    )
  }

  const commitAuthor = {
    authorName: adminName ?? DEFAULT_COMMIT_AUTHOR.name,
    authorEmail: adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()
  const rawSchema = (session?.schema_data ?? {}) as Record<string, unknown>
  const schema = rawSchema as SessionSchema
  const firmName = schema.business?.name ?? 'the firm'

  const system = `You are the site-structure assistant for ${firmName}'s published website. You manage the SET OF PAGES and the NAVIGATION — creating pages (with AI-written content), deleting pages, nesting/reordering nav. You do NOT edit page copy (a per-page content assistant does that) or the visual theme (a theme assistant does that).

${buildBrandVoiceBlock(schema)}

HOW THE SITE IS STRUCTURED
- Pages live under content/pages/ (and blog posts under content/posts/). A page's URL is derived from its filename; "/" nests, e.g. content/pages/industries--veterinarians.md renders at /industries/veterinarians.
- Audience / industry / "who we serve" pages are usually grouped under a hub (e.g. an "/industries" or "Who We Serve" parent in the nav). ALWAYS call list_site_pages first and MIRROR the site's existing grouping — nest new audience pages wherever the current audience pages live; never assume a structure.
- Every change is saved to the DRAFT site. Nothing goes live until the operator clicks Publish. Say "saved to draft — review and Publish", never "it's live".

STEP-BY-STEP CONFIRMATION (required)
- Before ANY create, delete, or content-generation call, state exactly what you will do and WAIT for the operator's explicit confirmation ("yes"/"go ahead").
- Perform ONE such operation per confirmation. Never delete or create multiple pages in a single turn. For a bulk request (e.g. "remove these four, add these four"), first lay out the full plan, then work through it one confirmed operation at a time.
- list_site_pages is read-only and needs no confirmation — use it freely to ground yourself.
- EXCEPTION — bulk reclassify: "move these N pages to Resources" (or a similar batch of moves) counts as ONE plan. State the full list, get a single "yes", then loop move_page over each item without re-asking per file. Report a short pass/fail summary at the end.

YOUR TOOLS
- list_site_pages() — list current pages (path + url + kind ("page"|"post") + whether each is in the nav) and the current navigation tree. Call this first.
- create_page({ title, slug?, brief?, addToNav?, parentUrl? }) — create a page and kick off an AI-written first draft grounded in the business profile. slug may nest with "/" (e.g. "industries/veterinarians"). parentUrl nests the nav link under an existing item (e.g. "/industries"). Returns a generationId; the draft lands shortly after.
- delete_page({ path }) — permanently remove a page (content/pages or content/posts) from the draft and strip its nav link. Pass the exact path from list_site_pages.
- move_page({ fromPath, toUrl, navAction? }) — relocate a page: reclassify a page ↔ blog post (Resources) or reparent it under another page. A blog post that was created as a page (e.g. content/pages/careers--foo.md at /careers/foo) becomes a Resource by moving it to /resources/foo with navAction "remove" (posts show on the Resources index, not the top nav). Reparent a page by moving it to a new parent URL with navAction "retarget" (default — its nav link follows). Adds a 301 redirect automatically.
- set_nav({ contents }) — replace the whole nav.json (a JSON string with { "primary": [ { "label", "url", "children"? } ], "cta"? }). Use only for explicit reordering/nesting beyond what create/delete already handle.
- file_mbp_suggestion({ summary, removedNiches?, addedNiches? }) — after the operator confirms an audience change, file a PENDING Master Business Profile suggestion to update the firm's target niches for admin approval. NEVER present this as done — it only queues a suggestion.

RULES
- Never claim success when a tool returns an error — tell the operator plainly and offer to retry.
- When audiences (target industries/niches) change, once the page work is confirmed, OFFER to file an MBP suggestion so the profile stays in sync — but only after asking, and make clear it's a pending suggestion an admin approves.
- Keep replies short and concrete.`

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system,
    messages: await convertToModelMessages(trimMessages(messages)),
    maxOutputTokens: 4000,
    tools: {
      list_site_pages: {
        description:
          'List the site\'s current pages (path, url, whether it is in the nav) and the current navigation tree. Read-only — call before planning any change.',
        inputSchema: z.object({}),
        execute: async () => {
          try {
            const [pages, posts] = await Promise.all([
              listTree(githubRepo, DRAFT_BRANCH, 'content/pages/'),
              listTree(githubRepo, DRAFT_BRANCH, 'content/posts/'),
            ])
            let nav: NavJson | null = null
            try {
              nav = parseNavJson((await readFile(githubRepo, NAV_PATH, DRAFT_BRANCH)).content)
            } catch {
              /* nav absent/unparseable — report pages only */
            }
            const entries = [...pages, ...posts]
              .filter((e) => e.type === 'blob' && e.path.endsWith('.md'))
              .map((e) => {
                const url = contentPathToUrl(e.path)
                return {
                  path: e.path,
                  url,
                  kind: e.path.startsWith('content/posts/') ? 'post' : 'page',
                  inNav: url ? navContainsUrl(nav?.primary ?? [], url) : false,
                }
              })
            return { pages: entries, nav: nav ?? { primary: [] } }
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Failed to list pages.' }
          }
        },
      },
      create_page: {
        description:
          'Create a page and start an AI-written first draft (grounded in the business profile). Adds a nav link (nested under parentUrl when given). Returns a generationId.',
        inputSchema: z.object({
          title: z.string().min(1).max(120).describe('Page title, e.g. "Veterinarians"'),
          slug: z
            .string()
            .optional()
            .describe('URL slug; "/" nests, e.g. "industries/veterinarians". Defaults from title.'),
          brief: z
            .string()
            .max(500)
            .optional()
            .describe('What the page should cover / who it is for — steers the AI draft.'),
          addToNav: z.boolean().optional().describe('Add a nav link (default true).'),
          parentUrl: z
            .string()
            .optional()
            .describe('Nest the nav link under this existing item url, e.g. "/industries".'),
        }),
        execute: async ({ title, slug, brief, addToNav, parentUrl }) => {
          const normalized = normalizeSlug(slug?.trim() || title)
          if (!normalized) return { error: 'Could not derive a valid slug from that title.' }
          const { url, path } = normalized
          try {
            try {
              await readFile(githubRepo, path, DRAFT_BRANCH)
              return { error: `A page already exists at ${url}.` }
            } catch (err) {
              if (!(err instanceof FileNotFoundError)) throw err
            }
            const starter = await writeFile(
              githubRepo,
              path,
              buildStarterPage(title, url, firmName),
              DRAFT_BRANCH,
              `Create page ${url} via AI (${adminEmail ?? 'admin'})`,
              commitAuthor
            )
            if (addToNav !== false) await appendNavItem(ctx, title, url, parentUrl?.trim() || undefined)

            const { data: row, error } = await supabase
              .from('new_page_generations')
              .insert({
                content_job_id: jobId,
                session_id: sessionId,
                target_path: path,
                page_url: url,
                title,
                brief: brief?.trim() || null,
                starter_sha: starter.blobSha,
                status: 'pending',
              })
              .select('id')
              .single()
            if (error || !row) {
              return { success: true, url, generationError: error?.message ?? 'AI draft could not be scheduled — the blank page was created.' }
            }
            after(async () => {
              try {
                await generateNewPage(row.id)
              } catch (err) {
                console.error('[site-assistant] AI draft trigger failed:', err)
              }
            })
            return { success: true, url, generationId: row.id }
          } catch (err) {
            if (err instanceof StaleShaError) {
              return { error: 'The navigation changed on the server mid-edit. Reload and try again.' }
            }
            return { error: err instanceof Error ? err.message : 'Failed to create the page.' }
          }
        },
      },
      delete_page: {
        description:
          'Permanently delete a page (content/pages or content/posts) from the draft and strip its nav link. Pass the exact path from list_site_pages.',
        inputSchema: z.object({
          path: z.string().describe('Repo path of the page, e.g. content/pages/industries--restaurants.md'),
        }),
        execute: async ({ path: rawPath }) => {
          const path = validPagePath(rawPath)
          if (!path) return { error: 'That is not a valid page path (must be a .md under content/pages or content/posts).' }
          try {
            const blob = await readFile(githubRepo, path, DRAFT_BRANCH)
            await deleteFile(
              githubRepo,
              path,
              DRAFT_BRANCH,
              blob.sha,
              `Delete ${path.split('/').pop()} via AI (${adminEmail ?? 'admin'})`,
              commitAuthor
            )
            await stripNavReference(ctx, path)
            return { success: true, deleted: contentPathToUrl(path) ?? path }
          } catch (err) {
            if (err instanceof FileNotFoundError) return { error: `No page found at ${path}.` }
            if (err instanceof StaleShaError) {
              return { error: 'That page changed on the server mid-edit. Reload and try again.' }
            }
            return { error: err instanceof Error ? err.message : 'Failed to delete the page.' }
          }
        },
      },
      move_page: {
        description:
          'Relocate a page on the draft site: reclassify a page ↔ blog post (Resources), or reparent a page under another. Moves the file, fixes its canonical, adds a 301 redirect, and syncs its nav link. Use navAction "remove" when moving something INTO Resources (posts show on the Resources index, not the top nav); "retarget" (default) keeps its nav link and points it at the new URL.',
        inputSchema: z.object({
          fromPath: z
            .string()
            .describe('Current repo path, e.g. content/pages/careers--foo.md'),
          toUrl: z
            .string()
            .describe('Destination root-relative URL, e.g. /resources/foo or /services/foo'),
          navAction: z
            .enum(['retarget', 'remove', 'none'])
            .optional()
            .describe('Nav link handling; default retarget.'),
        }),
        execute: async ({ fromPath: rawFrom, toUrl, navAction }) => {
          const fromPath = safePath(rawFrom)
          if (
            !fromPath ||
            !fromPath.endsWith('.md') ||
            !(fromPath.startsWith('content/pages/') || fromPath.startsWith('content/posts/'))
          ) {
            return { error: 'fromPath must be a .md under content/pages or content/posts.' }
          }
          const fromUrl = contentPathToUrl(fromPath)
          if (!fromUrl) return { error: 'Could not resolve the current page URL.' }
          const toPath = urlToContentPath(toUrl)
          if (!toPath) {
            return { error: 'Invalid destination — the home page and external URLs cannot be targeted.' }
          }
          const destUrl = contentPathToUrl(toPath) as string
          if (fromPath === toPath) return { error: 'Source and destination are the same.' }

          // Refuse moving a page that has nested sub-pages (would orphan them).
          const pm = /^content\/pages\/(.+)\.md$/.exec(fromPath)
          if (pm) {
            const prefix = pm[1] + '--'
            const kids = await listTree(githubRepo, DRAFT_BRANCH, 'content/pages/')
            if (
              kids.some(
                (e) =>
                  e.type === 'blob' &&
                  e.path.endsWith('.md') &&
                  e.path !== fromPath &&
                  e.path.slice('content/pages/'.length).startsWith(prefix)
              )
            ) {
              return { error: 'That page has sub-pages nested under it — move or delete those first.' }
            }
          }

          try {
            const src = await readFile(githubRepo, fromPath, DRAFT_BRANCH)
            const res = await relocateFile(ctx, {
              fromPath,
              toPath,
              fromUrl,
              toUrl: destUrl,
              expectedSha: src.sha,
              reason: 'Relocated via AI',
            })
            const action = navAction ?? 'retarget'
            if (action === 'retarget') await retargetNavUrl(ctx, fromUrl, destUrl)
            else if (action === 'remove') await stripNavReference(ctx, fromPath)
            return { success: true, fromUrl, toUrl: destUrl, moved: res.moved }
          } catch (err) {
            if (err instanceof DestinationOccupiedError) {
              return { error: `A page already exists at ${destUrl}.` }
            }
            if (err instanceof FileNotFoundError) return { error: `No page found at ${fromPath}.` }
            if (err instanceof StaleShaError) {
              return { error: 'That page changed on the server mid-edit. Reload and try again.' }
            }
            return { error: err instanceof Error ? err.message : 'Failed to move the page.' }
          }
        },
      },
      set_nav: {
        description:
          'Replace the whole navigation (nav.json). contents is a JSON string: { "primary": [ { "label", "url", "children"? } ], "cta"? }. Use for explicit reordering/nesting only.',
        inputSchema: z.object({
          contents: z.string().describe('Full nav.json as a JSON string.'),
        }),
        execute: async ({ contents }) => {
          let parsed: NavJson
          try {
            parsed = parseNavJson(contents)
          } catch (err) {
            return { error: err instanceof Error ? err.message : 'Invalid nav.json.' }
          }
          try {
            let expectedSha: string | undefined
            try {
              expectedSha = (await readFile(githubRepo, NAV_PATH, DRAFT_BRANCH)).sha
            } catch (err) {
              if (!(err instanceof FileNotFoundError)) throw err
            }
            await writeFile(
              githubRepo,
              NAV_PATH,
              serializeNavJson(parsed),
              DRAFT_BRANCH,
              `Edit nav.json via AI (${adminEmail ?? 'admin'})`,
              { expectedSha, ...commitAuthor }
            )
            return { success: true }
          } catch (err) {
            if (err instanceof StaleShaError) {
              return { error: 'The navigation changed on the server mid-edit. Reload and try again.' }
            }
            return { error: err instanceof Error ? err.message : 'Failed to save the navigation.' }
          }
        },
      },
      file_mbp_suggestion: {
        description:
          "Queue a PENDING Master Business Profile suggestion to update the firm's target niches after an audience change. Does not apply — an admin approves it in MBP review.",
        inputSchema: z.object({
          summary: z.string().describe('One-line summary of the audience change.'),
          removedNiches: z.array(z.string()).optional().describe('Niche names to remove.'),
          addedNiches: z
            .array(
              z.object({
                name: z.string(),
                description: z.string().optional(),
                valueProp: z.string().optional(),
              })
            )
            .optional()
            .describe('New niches to add.'),
        }),
        execute: async ({
          summary,
          removedNiches,
          addedNiches,
        }: {
          summary: string
          removedNiches?: string[]
          addedNiches?: { name: string; description?: string; valueProp?: string }[]
        }) => {
          const removed = new Set((removedNiches ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean))
          const added = (addedNiches ?? []).filter((n) => n.name.trim())
          if (removed.size === 0 && added.length === 0) {
            return { error: 'Nothing to change — pass removedNiches and/or addedNiches.' }
          }
          const current = (schema.niches ?? []).filter((n) => n?.name)
          const next = [
            ...current.filter((n) => !removed.has(n.name.trim().toLowerCase())),
            ...added.map((n) => ({
              name: n.name.trim(),
              description: n.description?.trim() ?? '',
              valueProp: n.valueProp?.trim() ?? '',
            })),
          ]
          const { filed } = await insertMbpSuggestion(supabase, {
            sessionId,
            origin: 'site_structure',
            summary,
            changes: [
              {
                fieldPath: 'niches',
                op: 'set',
                proposedValue: next,
                rationale: 'Audience pages changed on the live site; sync the MBP target niches.',
              },
            ],
            schema: rawSchema,
          })
          return filed
            ? { success: true, note: 'Pending MBP suggestion filed for admin approval.' }
            : { error: 'Could not file the MBP suggestion.' }
        },
      },
    },
    stopWhen: stepCountIs(16),
    onFinish: async ({ totalUsage }) => {
      await recordTokenUsage({
        task: 'content',
        sessionId,
        createdBy: user?.id ?? null,
        stage: 'site_structure_edit',
        model: 'claude-sonnet-4-6',
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
      })
      await supabase
        .from('sessions')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', sessionId)
    },
  })

  return result.toUIMessageStreamResponse({
    onError: () => 'The assistant hit an error — please try again.',
  })
}
