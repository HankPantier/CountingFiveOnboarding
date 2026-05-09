const BANNED_PHRASES = [
  "in today's",
  'navigate',
  'leverage',
  'utilize',
  'game-changer',
  'game-changing',
  'seamless',
  'seamlessly',
  'unlock',
  'empower',
  'empowers',
  'cutting-edge',
  'state-of-the-art',
  'tailored solutions',
  'bespoke',
  'passionate about',
  "we're passionate",
  'dedicated to',
  "we're dedicated",
  'partner with us',
  'your trusted partner',
  'in conclusion',
  'to summarize',
]

const SENTENCE_START_PATTERN = /^as a [a-z]/im

const VAGUE_CLAIM_TRIGGERS = [
  'the region',
  'across the country',
  'many clients',
  'various industries',
  'wide range',
  'countless',
  'numerous',
  'a variety of',
]

const VAGUE_TRIGGER_RE = new RegExp(VAGUE_CLAIM_TRIGGERS.map(t => t.replace(/ /g, '\\s+')).join('|'), 'i')
const WE_OPENER_RE = /^(we|our)\b/i
// A "specific" within ±N chars of a vague trigger redeems the sentence.
const SPECIFIC_PATTERN = /\b(\d+|massachusetts|tyngsborough|cpa|aicpa|pfs|ea|sage intacct|quickbooks)\b/i

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n/
const FENCED_CODE_RE = /```[\s\S]*?```/g

function splitSentences(content: string): string[] {
  // Strip code fences and frontmatter so prose-only checks don't trip on them.
  const stripped = content.replace(FRONTMATTER_RE, '').replace(FENCED_CODE_RE, '')
  const out: string[] = []
  for (const piece of stripped.split(/(?<=[.!?])\s+/)) {
    const trimmed = piece.trim()
    if (trimmed) out.push(trimmed)
  }
  return out
}

export function validateContent(content: string): { passed: boolean; flagged: string[] } {
  const lower = content.toLowerCase()
  const flagged: string[] = []

  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) flagged.push(phrase)
  }

  if (SENTENCE_START_PATTERN.test(content)) {
    flagged.push('Sentence starting with "As a [role]..."')
  }

  // Single sentence pass — covers consecutive We/Our run and vague claims so we
  // don't traverse the array three times.
  const sentences = splitSentences(content)
  let weRun = 0
  let consecutiveFlagged = false
  for (const s of sentences) {
    if (WE_OPENER_RE.test(s)) {
      weRun++
      if (weRun >= 3 && !consecutiveFlagged) {
        flagged.push('Three or more consecutive sentences open with "We" or "Our"')
        consecutiveFlagged = true
      }
    } else {
      weRun = 0
    }

    // Cheap pre-filter: skip the trigger-list scan unless the sentence has any
    // of the trigger substrings via one combined regex.
    if (VAGUE_TRIGGER_RE.test(s) && !SPECIFIC_PATTERN.test(s)) {
      const lc = s.toLowerCase()
      for (const trigger of VAGUE_CLAIM_TRIGGERS) {
        if (lc.includes(trigger)) {
          flagged.push(`Vague claim: "${trigger}" without a specific (number/place/credential)`)
          break
        }
      }
    }
  }

  return {
    // Zero-tolerance retry trigger: if we caught anything, retry once.
    passed: flagged.length === 0,
    flagged,
  }
}

export const ANTI_SLOP_RULES = `ANTI-SLOP RULES — read before writing a single word:

BANNED WORDS AND PHRASES (never use these):
- "In today's [adjective] landscape"
- "Navigate", "leverage", "utilize"
- "Game-changer", "game-changing"
- "Seamless", "seamlessly"
- "Unlock" (as metaphor)
- "Empower", "empowers"
- "Cutting-edge", "state-of-the-art"
- "Tailored solutions", "bespoke"
- "Passionate about", "we're passionate"
- "Dedicated to", "we're dedicated"
- "Partner with us", "your trusted partner"
- "In conclusion", "to summarize"
- Any sentence starting with "As a [role]..."

STRUCTURAL RULES (validated post-generation; any single violation triggers a retry):
- No more than 2 consecutive sentences open with "We" or "Our"
- No paragraph that begins and ends with a superlative claim
- Vary sentence length deliberately: mix short punchy sentences with longer ones
- Every claim must be specific. Phrases like "the region", "many clients", "various industries", "wide range", "countless", "numerous" only pass if the same sentence names a number, a place (e.g. Massachusetts, Tyngsborough), or a credential (e.g. CPA, AICPA, PFS).
- Proof over assertion: if you claim expertise, name the credential or give the example

VOICE RULES:
- Write like the firm's smartest person talking to a prospective client at a coffee meeting — knowledgeable, direct, no fluff
- The firm should sound like it already knows the client's problem, not like it's trying to impress them
- If something would sound like filler in a conversation, it's filler in copy too — cut it`
