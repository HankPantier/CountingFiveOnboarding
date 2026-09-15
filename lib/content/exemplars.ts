// Few-shot exemplars injected into the content generators' cached static
// prefixes. Rules alone ("12-18 words, benefit-led") leave the model guessing at
// what "good" looks like; a single gold example does far more to lift quality and
// cut retries. These are JOB-CONSTANT strings — they live in the cached prefix so
// they cost one cache write per job, then ride as cache reads on every page.
//
// They are deliberately firm-agnostic (no real firm name/facts) so nothing here
// can leak into a specific client's copy — they demonstrate SHAPE and VOICE, not
// content to reuse. Every generator prompt already says "never copy verbatim".

// Weak-vs-strong pairs for the four failure modes that most often force a human
// edit: passive/self-focused hero subheads, run-on service-card descriptions,
// bloated-or-thin FAQ answers, and generic openers. Sent alongside ANTI_SLOP_RULES
// so the flagged-phrase retry rewrites TOWARD these patterns rather than swapping
// one hollow synonym for another.
export const WRITING_EXAMPLES = `WRITE LIKE THESE (study the ✓ / ✗ contrast — the ✗ versions are the exact mistakes to avoid):

Hero subhead (12-18 words, speaks to the reader's outcome):
  ✗ "Expert accounting and tax services from a trusted, dedicated team of professionals" (generic, self-focused, zero benefit)
  ✗ "We help businesses with all of their accounting and tax needs" (passive, vague, restates the obvious)
  ✓ "Know your tax exposure before year-end, so a surprise bill never derails your cash flow"
  ✓ "Clean books and a real plan, so you can price jobs and take draws with confidence"

Page opener (first paragraph — earn the read, name the reader's problem):
  ✗ "In today's fast-paced business environment, managing your finances is more important than ever. Our firm is dedicated to providing tailored solutions for all your needs." (filler, banned phrases, says nothing)
  ✓ "Most contractors we meet are profitable on paper and still short on cash. The gap is almost always in job costing and the timing of estimated taxes, and both are fixable once someone actually looks at the numbers."

Service-card description (1-3 tight sentences, concrete, not a run-on):
  ✗ "Our comprehensive tax planning service covers federal, state, and local obligations, including quarterly estimated payments, retirement contributions, entity structure optimization, and year-end reviews to minimize your overall tax burden." (one exhausting sentence, lists everything, lands nowhere)
  ✓ "Quarterly tax planning built around your actual numbers, not last year's. We model estimated payments and entity elections before the deadline, so nothing is a surprise in April."

FAQ answer (40-60 words, answer the question directly, then one useful specific):
  ✗ "It depends on your situation. There are many factors involved, and we'd be happy to discuss your unique needs to find the best solution for you." (evasive, no information, pure deflection)
  ✓ "For most S-corps, a reasonable salary lands between 40 and 60 percent of net profit, with the rest taken as distributions. The IRS weighs your role, hours, and industry pay data, so we document the basis for the number rather than picking a round figure."`

// A compact, fully-annotated mini-page showing the house style end to end: a
// specific opener, a content-split with a real image annotation, and a
// service-cards block using the `### Title` + `icon:` item form. Injected into the
// page-body generator so the dense block-annotation spec has a worked example to
// anchor on (the biggest driver of annotation retries).
export const PAGE_BODY_EXEMPLAR = `WORKED EXAMPLE — a strong section sequence in the exact annotation format (illustrative firm; never copy its facts):

<!-- block: intro-text | variant: centered -->
## Bookkeeping that tells you something

Numbers you can't act on aren't worth much. We keep the books current to the week and translate them into the two or three figures that actually change what you do next.

<!-- block: content-split | variant: image-right | image: monthly-close-review.jpg | alt: "Accountant reviewing a monthly close with a small business owner at a laptop" | query: "accountant small business owner reviewing finances" -->
## A monthly close you'll actually read

Every month you get a two-page summary: cash position, margin by service line, and anything that moved more than ten percent. No 40-page export you'll never open. When a trend needs attention, we flag it before it becomes a problem, not a quarter later.

<!-- block: service-cards | variant: 3-col -->
## What working with us looks like

### Weekly bookkeeping
icon: Calculator

Transactions categorized weekly, not in a January scramble. You always know where you stand before you make a decision.

### Monthly close and review
icon: FileCheck

A clean close plus a short call to walk the numbers. You leave knowing your margin and your next move.

### Payroll and filings
icon: Users

Payroll run, quarterly filings handled, deadlines tracked. One less thing that keeps you up in April.`

// A strong outline whose section descriptions are working briefs — each names the
// concrete input (a niche persona, a proof point, a keyword) it draws on. Injected
// into the outline generator to demonstrate the specificity the spec demands.
export const OUTLINE_EXEMPLAR = `EXAMPLE OF A STRONG OUTLINE (note how each description names a specific audience, pain, or proof — never a generic label):

{
  "h1": "Accounting for construction contractors",
  "sections": [
    { "h2": "Why contractor books break down", "description": "Open on the specific pain: profitable-on-paper contractors who are cash-poor because job costing and WIP aren't tracked. Speak to the owner/GM who prices the jobs.", "word_count": 180 },
    { "h2": "Job costing that survives an audit", "description": "Explain how we track cost-to-complete and WIP by project; tie to the 'construction job costing' keyword and the firm's Sage Intacct expertise.", "word_count": 220 },
    { "h2": "Timing estimated taxes around your cash cycle", "description": "Address the buying trigger — a surprise tax bill in a lumpy-revenue year. Concrete: how we schedule estimates against draw timing.", "word_count": 200 },
    { "h2": "Bonding and lender-ready financials", "description": "Proof/authority: reference the firm's work preparing reviewed statements bonding companies accept. Names the decision the reader faces (winning bigger bids).", "word_count": 180 },
    { "h2": "Getting started", "description": "Close with the specific first step and CTA to /contact. No filler recap.", "word_count": 120 }
  ],
  "target_keyword": "accounting for construction contractors",
  "notes": "Write to the owner-operator, not a CFO. Lead with cash flow, not compliance."
}`

// Good/bad short-copy example for the interactive Generate Content assistant
// (LinkedIn bios, social posts). Not job-cached — the assistant builds its prompt
// per turn — but small enough that the grounding is worth the tokens.
export const SHORT_COPY_EXEMPLAR = `EXAMPLE — a LinkedIn bio in the house voice (illustrative; ground every real one in the profile facts):
  ✗ "Passionate CPA dedicated to empowering businesses to unlock their full potential with tailored, cutting-edge financial solutions." (every banned phrase at once, says nothing specific)
  ✓ "CPA who works with construction and trades businesses in the Merrimack Valley. I keep job costing honest and estimated taxes boring, so owners can price work and take draws without second-guessing the numbers."`
