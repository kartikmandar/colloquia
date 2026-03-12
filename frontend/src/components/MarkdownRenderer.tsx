/**
 * MarkdownRenderer — renders markdown content with syntax highlighting and GFM support.
 */

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import "katex/dist/katex.min.css";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps): React.ReactElement {
  const [copiedBlock, setCopiedBlock] = useState<number | null>(null);
  let codeBlockIndex = 0;

  const handleCopy = useCallback((code: string, index: number): void => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedBlock(index);
      setTimeout(() => setCopiedBlock(null), 2000);
    });
  }, []);

  const components: Components = {
    a: ({ children, href, ...props }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    ),
    pre: ({ children, ...props }) => {
      const index = codeBlockIndex++;
      // Extract text content from children for copy button
      const extractText = (node: React.ReactNode): string => {
        if (typeof node === "string") return node;
        if (Array.isArray(node)) return node.map(extractText).join("");
        if (node && typeof node === "object" && "props" in node) {
          const el = node as React.ReactElement<{ children?: React.ReactNode }>;
          return extractText(el.props.children);
        }
        return "";
      };
      const codeText: string = extractText(children);

      return (
        <div className="markdown-code-block">
          <button
            type="button"
            className="markdown-copy-btn"
            onClick={(): void => handleCopy(codeText, index)}
          >
            {copiedBlock === index ? "Copied!" : "Copy"}
          </button>
          <pre {...props}>{children}</pre>
        </div>
      );
    },
    code: ({ children, className: codeClassName, ...props }) => {
      // If className exists, it's a fenced code block (highlight.js adds language class)
      const isBlock: boolean = Boolean(codeClassName);
      if (isBlock) {
        return (
          <code className={codeClassName} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className="markdown-inline-code" {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={`markdown-prose ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default MarkdownRenderer;
