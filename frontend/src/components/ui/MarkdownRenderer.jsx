import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ─── Styled markdown renderer matching VEORI design system ────────────────────
export default function MarkdownRenderer({ content, className = '' }) {
  return (
    <div className={`prose-veori ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ─── Headings ──────────────────────────────────────────────────────
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-text-primary mt-4 mb-2 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-bold text-text-primary mt-3 mb-1.5 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-text-primary mt-3 mb-1 first:mt-0">
              {children}
            </h3>
          ),

          // ─── Paragraph ─────────────────────────────────────────────────────
          p: ({ children }) => (
            <p className="text-text-secondary leading-[1.7] mb-3 last:mb-0">
              {children}
            </p>
          ),

          // ─── Bold / Italic ─────────────────────────────────────────────────
          strong: ({ children }) => (
            <strong className="font-semibold text-text-primary">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-text-secondary">{children}</em>
          ),

          // ─── Lists ─────────────────────────────────────────────────────────
          ul: ({ children }) => (
            <ul className="my-2 space-y-1 pl-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 space-y-1 pl-0 list-none counter-reset-list">
              {children}
            </ol>
          ),
          li: ({ children, ordered, index }) => (
            <li className="flex gap-2.5 text-text-secondary leading-[1.7]">
              <span className="text-primary flex-shrink-0 mt-0.5 font-medium">
                {ordered ? `${(index || 0) + 1}.` : '•'}
              </span>
              <span className="flex-1">{children}</span>
            </li>
          ),

          // ─── Code ──────────────────────────────────────────────────────────
          code: ({ inline, children }) => {
            if (inline) {
              return (
                <code className="bg-surface border border-border-subtle text-primary px-1.5 py-0.5 rounded text-[13px] font-mono">
                  {children}
                </code>
              )
            }
            return (
              <code className="block bg-[#0A1628] border border-border-subtle rounded-lg px-4 py-3 text-[13px] font-mono text-[#7DD3FC] leading-relaxed overflow-x-auto my-3">
                {children}
              </code>
            )
          },
          pre: ({ children }) => (
            <pre className="bg-[#0A1628] border border-border-subtle rounded-lg overflow-hidden my-3">
              {children}
            </pre>
          ),

          // ─── Blockquote ────────────────────────────────────────────────────
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/50 pl-4 my-3 text-text-muted italic">
              {children}
            </blockquote>
          ),

          // ─── Table ─────────────────────────────────────────────────────────
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="w-full border-collapse text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border-default">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="text-left px-3 py-2 text-text-primary font-semibold text-xs uppercase tracking-wide">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-text-secondary border-b border-border-subtle/50">
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-elevated/30 transition-colors">{children}</tr>
          ),

          // ─── Horizontal rule ───────────────────────────────────────────────
          hr: () => <hr className="border-border-subtle my-4" />,

          // ─── Links ─────────────────────────────────────────────────────────
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:text-primary-hover underline underline-offset-2"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
