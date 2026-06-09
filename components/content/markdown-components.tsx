import type { Components } from 'react-markdown'

// Style mapping for ReactMarkdown — uses the project's design tokens directly
// instead of relying on the `prose` plugin (Tailwind v4, no typography plugin).
// Shared by the content review modal and the content-editor View.
export const MARKDOWN_COMPONENTS: Components = {
  h1: (props) => (
    <h1 className="font-heading font-bold text-xl text-brand-navy mt-4 mb-2" {...props} />
  ),
  h2: (props) => (
    <h2 className="font-heading font-bold text-lg text-brand-navy mt-4 mb-2" {...props} />
  ),
  h3: (props) => (
    <h3 className="font-heading font-semibold text-base text-brand-navy mt-3 mb-1.5" {...props} />
  ),
  h4: (props) => (
    <h4 className="font-heading font-semibold text-sm text-brand-navy mt-3 mb-1" {...props} />
  ),
  p: (props) => <p className="my-2.5" {...props} />,
  ul: (props) => <ul className="list-disc pl-6 my-2.5 space-y-1" {...props} />,
  ol: (props) => <ol className="list-decimal pl-6 my-2.5 space-y-1" {...props} />,
  li: (props) => <li {...props} />,
  a: (props) => (
    <a className="text-brand-cyan hover:underline" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  strong: (props) => (
    <strong className="font-heading font-semibold text-text-primary" {...props} />
  ),
  em: (props) => <em className="italic" {...props} />,
  code: (props) => (
    <code className="font-mono text-xs bg-surface-subtle px-1 py-0.5 rounded text-brand-navy" {...props} />
  ),
  pre: (props) => (
    <pre className="bg-surface-subtle border border-border-default rounded p-3 my-3 overflow-auto text-xs font-mono" {...props} />
  ),
  blockquote: (props) => (
    <blockquote className="border-l-4 border-brand-cyan pl-4 italic my-3 text-text-secondary" {...props} />
  ),
  table: (props) => (
    <div className="overflow-x-auto my-3">
      <table className="min-w-full border-collapse border border-border-default text-sm" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-surface-subtle" {...props} />,
  th: (props) => (
    <th className="border border-border-default px-3 py-1.5 text-left font-heading font-semibold" {...props} />
  ),
  td: (props) => <td className="border border-border-default px-3 py-1.5" {...props} />,
  hr: () => <hr className="my-4 border-border-default" />,
}
