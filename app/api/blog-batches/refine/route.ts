import { NextResponse } from 'next/server'
import { getCurrentUser, hasCapability } from '@/lib/auth/access'
import { refineBlogIdea, type RefinedBlogIdea } from '@/lib/content/blog-idea-refiner'
import { asContentType } from '@/lib/content/content-types'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_SEED_LENGTH = 300
const MAX_INSTRUCTION_LENGTH = 300

interface RefineBody {
  seed?: string
  current?: RefinedBlogIdea
  instruction?: string
  contentType?: string
}

// Brand-agnostic idea refinement for the blog-first tool. No client is selected
// yet, so there is nothing session-scoped to gate — but each call spends AI
// budget, so it still requires the manager capability (admins pass implicitly).
export async function POST(req: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasCapability(user, 'manager')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: RefineBody
  try {
    body = (await req.json()) as RefineBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const seed = typeof body.seed === 'string' ? body.seed.trim() : ''
  if (!seed) {
    return NextResponse.json({ error: 'A topic is required' }, { status: 400 })
  }
  if (seed.length > MAX_SEED_LENGTH) {
    return NextResponse.json(
      { error: `Topic must be ${MAX_SEED_LENGTH} characters or fewer` },
      { status: 400 }
    )
  }
  const instruction =
    typeof body.instruction === 'string' ? body.instruction.trim().slice(0, MAX_INSTRUCTION_LENGTH) : undefined
  const contentType = asContentType(body.contentType)

  const idea = await refineBlogIdea({ seed, current: body.current ?? null, instruction, contentType })
  if (!idea) {
    return NextResponse.json({ error: 'Could not refine the idea — please try again' }, { status: 502 })
  }

  return NextResponse.json({ idea })
}
