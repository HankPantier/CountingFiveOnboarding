// Ambient declaration for `text-readability` (no bundled types, no @types package).
// It default-exports a singleton with these methods. We only declare the methods
// the audit engine uses; extend as needed.
declare module 'text-readability' {
  interface TextReadability {
    fleschKincaidGrade(text: string): number
    fleschReadingEase(text: string): number
    lexiconCount(text: string, removePunctuation?: boolean): number
    sentenceCount(text: string): number
    syllableCount(text: string, lang?: string): number
    textStandard(text: string, floatOutput?: boolean): string
  }
  const rs: TextReadability
  export default rs
}
