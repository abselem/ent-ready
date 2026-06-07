"use client";

import katex from "katex";

interface Segment {
  type: "text" | "inline" | "block";
  content: string;
}

// Splits a string into plain text and LaTeX segments.
// $$...$$ → block (display mode)
// $...$   → inline math
function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  // Match $$...$$ first, then $...$
  const re = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({ type: "text", content: text.slice(last, m.index) });
    }
    const raw = m[0];
    if (raw.startsWith("$$")) {
      segments.push({ type: "block", content: raw.slice(2, -2).trim() });
    } else {
      segments.push({ type: "inline", content: raw.slice(1, -1).trim() });
    }
    last = m.index + raw.length;
  }

  if (last < text.length) {
    segments.push({ type: "text", content: text.slice(last) });
  }

  return segments;
}

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return latex;
  }
}

interface Props {
  text: string;
  className?: string;
}

/**
 * Renders text with embedded LaTeX.
 * Inline:  $log_2(x+1)$
 * Block:   $$\frac{a}{b}$$
 */
export function MathText({ text, className }: Props) {
  const segments = parseSegments(text);

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === "text") {
          return <span key={i}>{seg.content}</span>;
        }
        return (
          <span
            key={i}
            dangerouslySetInnerHTML={{
              __html: renderKatex(seg.content, seg.type === "block"),
            }}
          />
        );
      })}
    </span>
  );
}
