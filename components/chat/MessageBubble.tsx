'use client'
import type { UIMessage, TextUIPart } from 'ai'
import type { ReactNode } from 'react'

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const matches = [...text.matchAll(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)]
  let last = 0

  for (const match of matches) {
    if (match.index! > last) parts.push(text.slice(last, match.index))
    const raw = match[0]
    if (raw.startsWith('**')) {
      parts.push(<strong key={match.index} className="font-semibold">{raw.slice(2, -2)}</strong>)
    } else {
      parts.push(<em key={match.index}>{raw.slice(1, -1)}</em>)
    }
    last = match.index! + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function renderMarkdown(text: string): ReactNode {
  const lines = text.split('\n')
  const nodes: ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Headings — render as bold label, not a giant page title
    if (/^#{1,3}\s/.test(line)) {
      const content = line.replace(/^#{1,3}\s+/, '')
      nodes.push(
        <p key={i} className="font-semibold text-text-primary">
          {renderInline(content)}
        </p>
      )
      i++
      continue
    }

    // Ordered list — collect consecutive numbered lines
    if (/^\d+\.\s/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(<li key={i}>{renderInline(lines[i].replace(/^\d+\.\s+/, ''))}</li>)
        i++
      }
      nodes.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 pl-1">{items}</ol>)
      continue
    }

    // Unordered list — collect consecutive bullet lines
    if (/^[-*•]\s/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^[-*•]\s/.test(lines[i])) {
        items.push(<li key={i}>{renderInline(lines[i].replace(/^[-*•]\s+/, ''))}</li>)
        i++
      }
      nodes.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 pl-1">{items}</ul>)
      continue
    }

    // Skip blank lines (spacing from space-y on parent)
    if (line.trim() === '') {
      i++
      continue
    }

    // Regular paragraph
    nodes.push(<p key={i}>{renderInline(line)}</p>)
    i++
  }

  return <>{nodes}</>
}

export default function MessageBubble({
  message,
  isNew = false,
}: {
  message: UIMessage
  isNew?: boolean
}) {
  const text = message.parts
    .filter((p): p is TextUIPart => p.type === 'text')
    .map(p => p.text)
    .join('')

  if (!text) return null

  const isUser = message.role === 'user'

  return (
    <div
      className={[
        'flex',
        isUser ? 'justify-end' : 'justify-start',
        isNew ? 'motion-safe:animate-msg-in' : '',
      ].join(' ')}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm font-body leading-relaxed ${
          isUser
            ? 'bg-brand-navy text-text-inverse whitespace-pre-wrap'
            : 'bg-surface-card text-text-primary border border-border-default shadow-subtle space-y-2'
        }`}
      >
        {isUser ? text : renderMarkdown(text)}
      </div>
    </div>
  )
}
