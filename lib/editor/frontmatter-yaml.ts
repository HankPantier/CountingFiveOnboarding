// A commit-time safety net for the AI content editor.
//
// `lib/editor/frontmatter.ts` is a deliberately lenient, dependency-free parser
// (it splits each line on the first colon and never throws). That leniency is a
// problem at the write boundary: the editor's `replace_text` tool lets the model
// write raw frontmatter, and an unquoted value containing a colon-space — e.g.
// `title: Auto Leasing vs. Buying: Which Makes More Sense?` — sails through our
// parser but is INVALID YAML. The published site parses posts/pages with
// gray-matter (js-yaml), so that file then hard-fails `next build` at prerender.
//
// This validator runs the frontmatter block through js-yaml, the same engine the
// site build uses, so a malformed edit is rejected before it is committed to the
// draft rather than surfacing as a broken deploy.
import yaml from 'js-yaml'
import { splitFile } from './frontmatter'

// Returns an error message if the file's frontmatter is not valid YAML, or null
// when it is valid (or when there is no frontmatter block to check).
export function validateFrontmatterYaml(fullFileContent: string): string | null {
  const { frontmatter } = splitFile(fullFileContent)
  if (!frontmatter) return null
  try {
    yaml.load(frontmatter.raw)
    return null
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return `The edit would produce invalid YAML frontmatter (${reason}). A value containing a colon-and-space, a leading quote, bracket, or other YAML-special character must be wrapped in double quotes — e.g. title: "Foo: Bar".`
  }
}
