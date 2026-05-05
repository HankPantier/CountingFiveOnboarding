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

export function validateContent(content: string): { passed: boolean; flagged: string[] } {
  const lower = content.toLowerCase()
  const flagged: string[] = []

  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      flagged.push(phrase)
    }
  }

  if (SENTENCE_START_PATTERN.test(content)) {
    flagged.push('Sentence starting with "As a [role]..."')
  }

  return {
    passed: flagged.length <= 2,
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

STRUCTURAL RULES:
- No more than 2 sentences in a row that start with "We" or "Our"
- No paragraph that begins and ends with a superlative claim
- Vary sentence length deliberately: mix short punchy sentences with longer ones
- Every claim must be specific: "clients in 12 Massachusetts counties" not "clients across the region"
- Proof over assertion: if you claim expertise, name the credential or give the example

VOICE RULES:
- Write like the firm's smartest person talking to a prospective client at a coffee meeting — knowledgeable, direct, no fluff
- The firm should sound like it already knows the client's problem, not like it's trying to impress them
- If something would sound like filler in a conversation, it's filler in copy too — cut it`
