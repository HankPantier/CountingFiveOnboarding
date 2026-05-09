type Section = { word_count?: number }

// Strip frontmatter and fenced code blocks before counting; metadata shouldn't
// inflate word count.
export function countWords(markdown: string): number {
  if (!markdown) return 0
  const stripped = markdown
    .replace(/^---\n[\s\S]*?\n---\n/, '')   // YAML frontmatter
    .replace(/```[\s\S]*?```/g, '')          // fenced code blocks
    .trim()
  if (!stripped) return 0
  return stripped.split(/\s+/).length
}

export function targetWordCount(sections: Section[] | null | undefined): number {
  if (!Array.isArray(sections)) return 0
  return sections.reduce((sum, s) => sum + (typeof s?.word_count === 'number' ? s.word_count : 0), 0)
}

// Returns variance as a fraction (e.g. -0.4 = 40% under target). Null if target is 0.
export function wordCountVariance(actual: number, target: number): number | null {
  if (target <= 0) return null
  return (actual - target) / target
}
