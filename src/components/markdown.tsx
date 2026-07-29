"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (p) => <h1 className="mb-2 mt-4 text-xl font-bold" {...p} />,
        h2: (p) => <h2 className="mb-2 mt-4 text-lg font-bold" {...p} />,
        h3: (p) => <h3 className="mb-1 mt-3 text-base font-semibold" {...p} />,
        p: (p) => <p className="mb-3 leading-relaxed last:mb-0" {...p} />,
        ul: (p) => <ul className="mb-3 list-disc space-y-1 pl-5" {...p} />,
        ol: (p) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...p} />,
        blockquote: (p) => (
          <blockquote
            className="mb-3 border-l-2 border-accent-b/60 pl-3 text-muted"
            {...p}
          />
        ),
        a: (p) => (
          <a className="text-accent-a underline underline-offset-2" target="_blank" {...p} />
        ),
        table: (p) => (
          <div className="mb-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm" {...p} />
          </div>
        ),
        th: (p) => <th className="border border-line bg-panel-2 px-2 py-1 text-left" {...p} />,
        td: (p) => <td className="border border-line px-2 py-1" {...p} />,
        code: ({ className, children, ...rest }) => {
          const isBlock = /language-/.test(className ?? "");
          return isBlock ? (
            <code className={`${className} block`} {...rest}>
              {children}
            </code>
          ) : (
            <code
              className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[0.85em] text-accent-a"
              {...rest}
            >
              {children}
            </code>
          );
        },
        pre: (p) => (
          <pre
            className="mb-3 overflow-x-auto rounded-xl border border-line bg-[#0d1320] p-3 font-mono text-[13px] leading-relaxed"
            {...p}
          />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
