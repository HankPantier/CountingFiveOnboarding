import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import type { Extensions } from '@tiptap/core'

// The TipTap extension set for the content editor's prose regions. Kept
// deliberately minimal — only the marks/nodes the bubble toolbar exposes
// (bold, italic, link, H2/H3, bullet/ordered lists) plus StarterKit defaults.
// Heading levels 1–4 stay enabled so existing headings of any level survive a
// round-trip even though the toolbar only creates H2/H3.
//
// Shared by RichBodyEditor and the round-trip test so the tested config is
// exactly what ships. tiptap-markdown handles markdown parse + serialize.
export function buildProseExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      },
    }),
    Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
  ]
}
