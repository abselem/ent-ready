import { MathText } from "@/components/math-text";
import { apiOrigin } from "@/lib/api";
import type { LessonBlock } from "./types";

/** The same safe renderer is used by the student player and teacher preview. */
export function LessonBlockView({ block }: { block: LessonBlock }) {
  if (block.type === "code") return <div className="min-w-0 overflow-hidden rounded-xl border border-border">
    {block.language && <div className="border-b border-border bg-muted px-4 py-2 text-xs font-medium text-muted-foreground">{block.language}</div>}
    <pre className="max-w-full overflow-x-auto bg-[#0d1117] p-5 text-[13px] leading-relaxed text-[#e6edf3]"><code>{block.content}</code></pre>
  </div>;

  if (block.type === "image") {
    const src = block.content.startsWith("/static/") ? `${apiOrigin}${block.content}` : block.content;
    if (!src) return <p className="text-sm text-muted-foreground">Изображение пока не добавлено.</p>;
    if (!/^https?:\/\//i.test(src) && !src.startsWith("/static/")) return <p className="text-sm text-muted-foreground">Ссылка на изображение недоступна.</p>;
    return <figure className="min-w-0 space-y-3">
      {/* User-uploaded and external images have variable dimensions and origins. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={block.caption || "Изображение к уроку"} className="mx-auto max-h-[70vh] max-w-full rounded-xl border border-border object-contain" />
      {block.caption && <figcaption className="break-words text-center text-sm text-muted-foreground"><MathText text={block.caption} /></figcaption>}
    </figure>;
  }

  const content = block.content || "Содержимое шага пока не добавлено.";
  return <div className={block.type === "note" ? "min-w-0 rounded-r-xl border-l-4 border-primary bg-accent/50 p-5" : "min-w-0"}>
    <div className="test-question space-y-4 text-base leading-relaxed text-foreground">
      {content.split(/\n\s*\n/).map((paragraph, index) => <p key={index} className="whitespace-pre-wrap break-words"><MathText text={paragraph} /></p>)}
    </div>
    {!['text', 'note'].includes(block.type) && block.caption && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{block.caption}</p>}
  </div>;
}
