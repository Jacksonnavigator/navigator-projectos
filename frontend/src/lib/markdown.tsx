import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer. It builds React elements (never innerHTML), so any HTML in the
 * source is shown as text. Supports headings, lists, code blocks, bold, italics, inline code and
 * http(s) links only.
 */
export function Markdown({ source }: { source: string }) {
  return <div className="prose-lite text-sm">{renderBlocks(source)}</div>;
}

function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i += 1;
      out.push(
        <pre key={key++}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const content = inline(heading[2]!);
      out.push(level === 1 ? <h1 key={key++}>{content}</h1> : level === 2 ? <h2 key={key++}>{content}</h2> : <h3 key={key++}>{content}</h3>);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[i]!)) {
        items.push(<li key={items.length}>{inline(lines[i]!.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>);
        i += 1;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}\s|```|\s*[-*]\s|\s*\d+\.\s)/.test(lines[i]!)) para.push(lines[i++]!);
    out.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }
  return out;
}

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, idx) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) return <code key={idx}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) return <strong key={idx}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 1) return <em key={idx}>{part.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = link[2]!;
      if (/^https?:\/\//i.test(href)) {
        return (
          <a key={idx} href={href} target="_blank" rel="noopener noreferrer">
            {link[1]}
          </a>
        );
      }
      return <Fragment key={idx}>{link[1]}</Fragment>;
    }
    return <Fragment key={idx}>{part}</Fragment>;
  });
}
