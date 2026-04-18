import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MarkdownRenderer({ content, className = '' }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-[18px] font-semibold text-text-primary mt-4 mb-2 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[16px] font-semibold text-text-primary mt-3 mb-1.5 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[14px] font-semibold text-text-primary mt-3 mb-1 first:mt-0">{children}</h3>,
          p:  ({ children }) => <p className="text-text-secondary leading-[1.7] mb-3 last:mb-0 text-[14px]">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
          em:     ({ children }) => <em className="italic text-text-secondary">{children}</em>,
          ul: ({ children }) => <ul className="my-2 space-y-1 pl-0">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 space-y-1 pl-0">{children}</ol>,
          li: ({ children, ordered, index }) => (
            <li className="flex gap-2.5 text-text-secondary leading-[1.7] text-[14px]">
              <span className="text-primary flex-shrink-0 mt-0.5 font-medium text-[13px]">
                {ordered ? `${(index || 0) + 1}.` : '•'}
              </span>
              <span className="flex-1">{children}</span>
            </li>
          ),
          code: ({ inline, children }) => inline
            ? <code className="bg-elevated border border-border-subtle text-primary px-1.5 py-0.5 rounded-[3px] text-[12px] font-mono">{children}</code>
            : <code className="block bg-surface border border-border-subtle rounded-lg px-4 py-3 text-[12px] font-mono text-primary leading-relaxed overflow-x-auto my-3">{children}</code>,
          pre: ({ children }) => <pre className="bg-surface border border-border-subtle rounded-lg overflow-hidden my-3">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-4 my-3 text-text-muted italic">{children}</blockquote>,
          table: ({ children }) => <div className="overflow-x-auto my-3"><table className="w-full border-collapse text-[13px]">{children}</table></div>,
          thead: ({ children }) => <thead className="border-b border-border-default">{children}</thead>,
          th: ({ children }) => <th className="text-left px-3 py-2 text-text-primary font-semibold text-[11px] uppercase tracking-wide">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-text-secondary border-b border-border-subtle/50">{children}</td>,
          tr: ({ children }) => <tr className="hover:bg-elevated/30 transition-colors">{children}</tr>,
          hr: () => <hr className="border-border-subtle my-4" />,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-hover underline underline-offset-2">{children}</a>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
