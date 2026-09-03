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

// Heading-level AI tells (formulaic / "clever" titles). Scanned per heading line.
const HEADING_LINE_RE = /^#{1,6}[ \t]+.*$/gm
const HEADING_PARENTHETICAL_RE = /\([^)]*\)/
const HEADING_COLON_CLICHE_RE = /:\s*(?:a |an |the )?(?:deep dive|complete guide|ultimate guide|everything you need|what you need to know|a closer look)/i
const HEADING_FORMULAIC_RE = /\b(?:beyond the|the importance of|a closer look|demystif|decoding|unpacking)\b|\bwhat\b[^.\n]*\bactually\b/i
const HEADING_LISTICLE_RE = /^#{1,6}\s+\d+\s+(?:reasons|ways|tips|things|steps|secrets)\b/i
// Bare "actually"/"really" in a heading is a strong AI tell ("…the way you
// Actually run a business"). Heading-scoped, so false-positives stay low.
const HEADING_FILLER_RE = /\b(?:actually|really)\b/i

// Prose-level AI tells beyond the banned-word list.
const NEGATIVE_PARALLELISM_RE = /\bnot just\b[^.?!\n]*\bit'?s\b|\bnot only\b[^.?!\n]*\bbut also\b/i
const COPULA_AVOIDANCE_RE = /\b(?:serves as|stands as)\b/i
const SIGNPOSTING_PHRASES = [
  'at its core',
  "let's dive in",
  "let's take a look",
  'in this article',
  'when it comes to',
  'a testament to',
  'ever-evolving',
]

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

  // Heading + pattern tells run on prose only (frontmatter and code stripped so
  // a `##` inside a fenced block can't be mistaken for a real heading).
  const stripped = content.replace(FRONTMATTER_RE, '').replace(FENCED_CODE_RE, '')
  const strippedLower = stripped.toLowerCase()

  for (const heading of stripped.match(HEADING_LINE_RE) ?? []) {
    const h = heading.trim()
    if (HEADING_PARENTHETICAL_RE.test(h)) flagged.push(`Heading with parenthetical subtitle: "${h}"`)
    else if (HEADING_COLON_CLICHE_RE.test(h)) flagged.push(`Heading with cliché subtitle: "${h}"`)
    else if (HEADING_FORMULAIC_RE.test(h)) flagged.push(`Formulaic heading: "${h}"`)
    else if (HEADING_FILLER_RE.test(h)) flagged.push(`Filler word in heading ("actually"/"really"): "${h}"`)
    else if (HEADING_LISTICLE_RE.test(h)) flagged.push(`Listicle heading: "${h}"`)
  }

  if (NEGATIVE_PARALLELISM_RE.test(stripped)) flagged.push('Negative parallelism ("not just X, it\'s Y")')
  if (COPULA_AVOIDANCE_RE.test(stripped)) flagged.push('Copula avoidance ("serves as" / "stands as")')
  for (const phrase of SIGNPOSTING_PHRASES) {
    if (strippedLower.includes(phrase)) flagged.push(`Signposting/AI trope: "${phrase}"`)
  }

  return {
    // Zero-tolerance retry trigger: if we caught anything, retry once.
    passed: flagged.length === 0,
    flagged,
  }
}

// Deterministic punctuation humanizer. Em-dashes (and en-dashes used as dashes)
// are the strongest "written by AI" tell and models resist prompt-only bans, so
// we strip them after generation. Numeric en-dash ranges (600–1200) are kept,
// and fenced code / HTML block annotations are protected from rewriting.
export function humanizeDashes(text: string): string {
  const protectedBlocks: string[] = []
  const stash = (s: string): string => {
    protectedBlocks.push(s)
    return `\u0000${protectedBlocks.length - 1}\u0000`
  }

  let out = text
    .replace(/```[\s\S]*?```/g, stash)
    .replace(/<!--[\s\S]*?-->/g, stash)

  out = out
    // Em-dash → comma. Horizontal whitespace only, so we never merge lines.
    .replace(/[ \t]*—[ \t]*/g, ', ')
    // En-dash used as a dash between words → comma; digit ranges (9–5, 600–1200) stay.
    .replace(/([^\d\s])[ \t]*–[ \t]*([^\d\s])/g, '$1, $2')

  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => protectedBlocks[Number(i)])
}

// Canonical output-sanitize choke point. EVERY generator (and the interactive
// AI editor) should run its model-produced prose through this before persisting,
// so the "no AI red flags" guarantee never depends on each call site remembering
// the individual fixes. Today it just strips dashes; new deterministic cleanups
// belong here so they apply everywhere at once.
export function sanitizeGeneratedText(text: string): string {
  return humanizeDashes(text)
}

// Clean a single heading string: drop a trailing parenthetical subtitle
// ("… (Beyond the Buzzwords)") and normalize dashes. Used at the outline stage
// so page headings inherit clean titles. Colons are left alone — often legitimate.
export function cleanHeading(text: string): string {
  return humanizeDashes(text.replace(/\s*\([^)]*\)\s*$/, '')).trim()
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
- If something would sound like filler in a conversation, it's filler in copy too — cut it

HEADING RULES:
- Headings must be specific and benefit-driven, in sentence case
- No parenthetical subtitles, e.g. "(Beyond the Buzzwords)"
- No colon-cliché subtitles: "A Deep Dive", "A Complete/Ultimate Guide", "Everything You Need to Know", "What You Need to Know"
- Never use "What X Actually Means", "Beyond the …", "The Importance of …", "A Closer Look", "Demystifying / Decoding / Unpacking", or listicle titles ("5 Reasons …")
- No dashes (— or –) in headings

AI-TELL PATTERNS (never use these):
- Negative parallelism: "It's not just X, it's Y", "not only … but also"
- Copula avoidance: write "is", not "serves as" / "stands as"
- Signposting and persuasion tropes: "At its core", "Let's dive in", "Let's take a look", "In this article", "When it comes to"
- "A testament to", "ever-evolving", "in today's … landscape"
- Em-dashes and en-dashes (— –): use commas, periods, or colons instead. Keep en-dashes only for number ranges (e.g. 600–1200).`
