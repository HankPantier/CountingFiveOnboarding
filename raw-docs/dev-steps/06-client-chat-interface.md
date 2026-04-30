# Step 06 — Client Chat Interface (Core Streaming)

**Depends on:** Steps 01–05
**Unlocks:** Steps 07, 08
**Credentials needed:** `ANTHROPIC_API_KEY`
**Estimated time:** Day 5–7

---

## What This Step Accomplishes

A client opens their unique session URL and can have a streaming conversation with Claude. Messages are saved to the database after every exchange. Session state (schema, gap list, phase) is updated via tool calls. This is the core product experience.

---

## Implementation Tasks

### 1. Build the session page (server component)

`app/session/[id]/page.tsx`:
```typescript
import { createServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import ChatInterface from '@/components/chat/ChatInterface'

export default async function SessionPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient()

  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !session) notFound()

  if (session.status === 'approved') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">You're all set!</h1>
          <p className="text-gray-500 mt-2">Your onboarding is complete. Our team will be in touch soon.</p>
        </div>
      </div>
    )
  }

  // Load message history
  const { data: messages } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', params.id)
    .order('created_at', { ascending: true })

  return <ChatInterface sessionId={params.id} initialSession={session} initialMessages={messages ?? []} />
}
```

### 2. Build the chat API route

`app/api/chat/route.ts`:
```typescript
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { createServerClient } from '@/lib/supabase/server'
import { buildSystemPrompt } from '@/lib/agent/system-prompt'
import { trimMessages } from '@/lib/agent/trim-messages'
import { z } from 'zod'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { sessionId, messages } = await req.json()
  const supabase = createServerClient()

  // 1. Load session
  const { data: session, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (error || !session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  // 2. Guard against concurrent requests
  if (session.processing) {
    return NextResponse.json({ error: 'Already processing' }, { status: 429 })
  }

  // 3. Set processing flag
  await supabase.from('sessions').update({ processing: true }).eq('id', sessionId)

  try {
    const systemPrompt = buildSystemPrompt(session)
    const trimmedMessages = trimMessages(messages)

    // 4. Select model by phase
    const model = [3, 4].includes(session.current_phase)
      ? anthropic('claude-sonnet-4-6')
      : anthropic('claude-haiku-4-5-20251001')

    // 5. Stream with tool support
    const result = streamText({
      model,
      system: systemPrompt,
      messages: trimmedMessages,
      tools: {
        update_session_data: {
          description: 'Update collected session fields and advance phase state.',
          parameters: z.object({
            updates: z.record(z.string(), z.unknown()).describe('Field path → value pairs to write into schema_data'),
            resolvedGaps: z.array(z.string()).optional().describe('Gap field paths now resolved'),
            advancePhase: z.boolean().optional(),
          }),
          execute: async ({ updates, resolvedGaps, advancePhase }) => {
            await updateSessionSchema(supabase, sessionId, session, updates, resolvedGaps, advancePhase)
            return { success: true }
          },
        },
      },
      maxSteps: 5,
      onFinish: async ({ text, usage }) => {
        console.log(`[tokens] session=${sessionId} prompt=${usage.promptTokens} completion=${usage.completionTokens}`)
        await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: text })
        await supabase.from('sessions').update({
          last_activity_at: new Date().toISOString(),
          processing: false,
        }).eq('id', sessionId)
      },
    })

    return result.toDataStreamResponse()
  } catch (err) {
    // Always clear processing flag in finally equivalent
    await supabase.from('sessions').update({ processing: false }).eq('id', sessionId)
    throw err
  }
}

async function updateSessionSchema(supabase: any, sessionId: string, session: any, updates: any, resolvedGaps?: string[], advancePhase?: boolean) {
  // Merge updates into schema_data using dot-path notation
  const currentSchema = session.schema_data ?? {}
  const mergedSchema = deepMerge(currentSchema, updates)

  // Update resolved gaps
  const currentGaps = session.gap_list ?? []
  const updatedGaps = resolvedGaps
    ? currentGaps.map((g: any) => resolvedGaps.includes(g.field) ? { ...g, resolved: true } : g)
    : currentGaps

  const newPhase = advancePhase ? Math.min(session.current_phase + 1, 7) : session.current_phase

  await supabase.from('sessions').update({
    schema_data: mergedSchema,
    gap_list: updatedGaps,
    current_phase: newPhase,
    status: newPhase >= 1 ? 'in_progress' : session.status,
  }).eq('id', sessionId)
}

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key] !== null) {
      result[key] = deepMerge(target[key] ?? {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}
```

### 3. Build the system prompt builder

`lib/agent/system-prompt.ts`:
```typescript
import { getPhaseInstructions } from './phase-instructions'
import { buildGapListInstructions } from './gap-list'

export function buildSystemPrompt(session: any): string {
  const schema = session.schema_data ?? {}
  const gaps = session.gap_list ?? []
  const phase = session.current_phase

  const sparseSchema = serializeSchema(schema)
  const phaseInstructions = getPhaseInstructions(phase, session)
  const gapInstructions = phase >= 4 ? buildGapListInstructions(gaps) : ''

  return `You are an AI onboarding agent for CountingFive, a web design firm for CPA firms.
Your job is to guide a client through their website onboarding in 5–7 minutes total.

CURRENT PHASE: ${phase}
${phaseInstructions}

COLLECTED DATA SO FAR:
${sparseSchema}

${gapInstructions}

TOOL INSTRUCTIONS:
- Call update_session_data whenever the client confirms or provides new information
- Only set advancePhase: true when the current phase goals are genuinely complete
- Never skip required fields without explicit client permission

GUARDRAILS:
- Present MFP data in bulk sections, not field-by-field
- Batch Phase 4 questions 2–3 per exchange
- One follow-up probe per thin answer max — then record and move on
- The client's password should NEVER be entered here — direct them to a secure channel`.trim()
}

function serializeSchema(schema: any): string {
  const { _meta, ...rest } = schema
  const sparse = deepOmitEmpty(rest)
  return JSON.stringify(sparse, null, 2)
}

function deepOmitEmpty(obj: any): any {
  if (Array.isArray(obj)) {
    const filtered = obj.map(deepOmitEmpty).filter(v => v !== null && v !== undefined && v !== '')
    return filtered.length > 0 ? filtered : undefined
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: any = {}
    for (const [k, v] of Object.entries(obj)) {
      const cleaned = deepOmitEmpty(v)
      if (cleaned !== undefined && cleaned !== null && cleaned !== '') result[k] = cleaned
    }
    return Object.keys(result).length > 0 ? result : undefined
  }
  return obj === '' || obj === null ? undefined : obj
}
```

### 4. Build the message trimmer

`lib/agent/trim-messages.ts`:
```typescript
const MAX_MESSAGES = 20

export function trimMessages(messages: any[]): any[] {
  if (messages.length <= MAX_MESSAGES) return messages
  const first = messages.slice(0, 1)  // Always keep Phase 1 welcome
  const recent = messages.slice(-(MAX_MESSAGES - 1))
  return [...first, ...recent]
}
```

### 5. Build the gap list instruction builder

`lib/agent/gap-list.ts`:
```typescript
export function buildGapListInstructions(gaps: any[]): string {
  const unresolved = gaps.filter((g: any) => !g.resolved)
  const tier1 = unresolved.filter((g: any) => g.tier === 1)
  const tier2 = unresolved.filter((g: any) => g.tier === 2)
  const tier3 = unresolved.filter((g: any) => g.tier === 3)

  const sections = [
    tier1.length ? `TIER 1 — MUST ASK:\n${tier1.map((g: any) => `• ${g.label} (${g.field})`).join('\n')}` : '',
    tier2.length ? `TIER 2 — ASK IF UNDER 5 MIN:\n${tier2.map((g: any) => `• ${g.label} (${g.field})`).join('\n')}` : '',
    tier3.length ? `TIER 3 — SKIP IF RUNNING LONG:\n${tier3.map((g: any) => `• ${g.label} (${g.field})`).join('\n')}` : '',
  ].filter(Boolean)

  return sections.length ? `REMAINING GAPS:\n${sections.join('\n\n')}` : 'All gaps resolved.'
}
```

### 6. Build the ChatInterface client component

`components/chat/ChatInterface.tsx`:
```typescript
'use client'
import { useChat } from 'ai/react'
import { useEffect, useRef } from 'react'

export default function ChatInterface({ sessionId, initialSession, initialMessages }: {
  sessionId: string
  initialSession: any
  initialMessages: { role: string; content: string }[]
}) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const { messages, input, handleInputChange, handleSubmit, isLoading, append } = useChat({
    api: '/api/chat',
    body: { sessionId },
    initialMessages: initialMessages.map(m => ({ role: m.role as any, content: m.content, id: Math.random().toString() })),
    onFinish: () => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) },
  })

  // Auto-scroll on new messages
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Trigger agent greeting if no messages yet
  useEffect(() => {
    if (initialMessages.length === 0) {
      append({ role: 'user', content: '__init__' })
    }
  }, [])

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.filter(m => m.content !== '__init__').map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${m.role === 'user' ? 'bg-black text-white' : 'bg-gray-100 text-gray-900'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-2 text-sm text-gray-400">Typing...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          disabled={isLoading}
          placeholder="Type your reply..."
          className="flex-1 border rounded-lg px-3 py-2 text-sm"
        />
        <button type="submit" disabled={isLoading || !input.trim()} className="px-4 py-2 bg-black text-white rounded-lg text-sm disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  )
}
```

---

## Test Process

### T1 — Session page loads for a valid session ID
Navigate to `/session/{valid-uuid}`.
Expected: Chat interface renders. If no messages, the agent sends a greeting.

### T2 — Session page returns 404 for invalid ID
Navigate to `/session/not-a-real-id`.
Expected: Next.js 404 page (or custom not-found page).

### T3 — Streaming works in real time
Send a message in the chat.
Expected: Agent response appears character-by-character (streaming), not all at once.

### T4 — Messages are saved to the database
After one exchange, run:
```sql
SELECT role, LEFT(content, 80) as preview, created_at
FROM messages
WHERE session_id = 'YOUR_SESSION_ID'
ORDER BY created_at;
```
Expected: Both user and assistant messages appear.

### T5 — Processing flag is cleared after response
Immediately after sending a message, and after the response completes, check:
```sql
SELECT processing FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Expected: `false` after response completes.

### T6 — Tool call updates schema_data
Trigger a phase advance by confirming contact info. Then check:
```sql
SELECT schema_data->'contact' as contact, current_phase FROM sessions WHERE id = 'YOUR_SESSION_ID';
```
Expected: Contact fields populated, phase incremented.

### T7 — Approved session shows completion screen
Set a session to approved:
```sql
UPDATE sessions SET status = 'approved' WHERE id = 'YOUR_SESSION_ID';
```
Navigate to the session URL.
Expected: Completion screen, not the chat interface.

### T8 — Concurrent request is blocked
Send two messages in rapid succession (requires two browser tabs or a script).
Expected: Second request returns 429 "Already processing" while first is streaming.

---

## Common Failure Points

- **`maxSteps: 5` is required** — without it, Claude calls the tool and the response ends. The user sees nothing. This option allows Claude to call the tool and then continue the text response in the same stream.
- **processing flag never cleared** — if the streaming function throws or the client disconnects mid-stream, `processing` stays `true` and the session is permanently locked. Always clear it in both `onFinish` AND in a catch/finally block.
- **`__init__` trigger message** — the empty initial message trick kicks off the agent greeting. Filter it from the displayed messages so the client never sees it.
- **Message history size** — without trimming, a long session sends thousands of tokens of history on every exchange. The `trimMessages` function keeps only the last 20 messages. Build it in from the start.
