"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { api, apiOrigin } from "@/lib/api";

interface Lesson { id: number; title: string; group_id: number; scheduled_at: string | null; duration_min: number }
interface Block { id: number; type: string; content: string; language: string; caption: string; order_num: number }

export default function TeacherLessonPreview() {
  const { id } = useParams();
  const lessonId = Number(id);
  const router = useRouter();

  const { data: lesson } = useQuery<Lesson>({
    queryKey: ["lesson", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}`)).data,
    enabled: !!lessonId,
  });

  const { data: blocks = [], isLoading } = useQuery<Block[]>({
    queryKey: ["lesson-blocks", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}/blocks`)).data,
    enabled: !!lessonId,
  });

  const { data: groupLessons = [] } = useQuery<Lesson[]>({
    queryKey: ["group-lessons-preview", lesson?.group_id],
    queryFn: async () => (await api.get(`/groups/${lesson!.group_id}/lessons?limit=100`)).data,
    enabled: !!lesson?.group_id,
  });

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  }

  return (
    <div className="flex">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-[#0f172a] sticky top-0 overflow-y-auto" style={{ height: "100vh" }}>
        <div className="px-4 py-3 border-b border-border">
          <button
            onClick={() => router.push(`/teacher/lessons/${lessonId}`)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Редактор
          </button>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Предпросмотр · {groupLessons.length} урок{groupLessons.length !== 1 ? "а" : ""}
          </p>
        </div>
        <nav className="py-2 flex flex-col">
          {groupLessons.map((l, i) => (
            <Link
              key={l.id}
              href={`/teacher/lessons/${l.id}/preview`}
              className={`flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                l.id === lessonId
                  ? "bg-primary/10 text-primary font-medium border-r-2 border-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 font-medium ${
                l.id === lessonId ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}>
                {i + 1}
              </span>
              <span className="truncate leading-snug">{l.title}</span>
            </Link>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">
          <button
            onClick={() => router.push(`/teacher/lessons/${lessonId}`)}
            className="md:hidden flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Редактор
          </button>

          {/* Preview banner */}
          <div className="mb-6 flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-xs text-yellow-600 dark:text-yellow-400">
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            Предпросмотр — так видят студенты
          </div>

          {lesson && (
            <div className="mb-8">
              <h1 className="text-2xl font-bold leading-tight mb-1">{lesson.title}</h1>
              {lesson.scheduled_at && (
                <p className="text-sm text-muted-foreground">
                  {formatDate(lesson.scheduled_at)}
                  {lesson.duration_min > 0 && ` · ${lesson.duration_min} мин`}
                </p>
              )}
              <div className="mt-4 border-b border-border" />
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col gap-4">
              {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted/30 rounded-lg animate-pulse" />)}
            </div>
          ) : blocks.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Блоки не добавлены.</p>
          ) : (
            <div className="flex flex-col gap-5">
              {blocks.map(block => <BlockView key={block.id} block={block} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "text":
      return (
        <div className="text-sm leading-relaxed text-foreground">
          {block.content.split("\n\n").map((para, i) => (
            <p key={i} className="mb-3 last:mb-0 whitespace-pre-wrap">{para}</p>
          ))}
        </div>
      );
    case "code":
      return (
        <div className="rounded-xl overflow-hidden border border-border shadow-sm">
          {block.language && (
            <div className="flex items-center gap-2 bg-muted/60 px-4 py-2 border-b border-border">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-400/60" />
                <span className="w-3 h-3 rounded-full bg-yellow-400/60" />
                <span className="w-3 h-3 rounded-full bg-green-400/60" />
              </div>
              <span className="text-xs font-mono text-muted-foreground ml-1">{block.language}</span>
            </div>
          )}
          <pre className="bg-[#0d1117] text-[#e6edf3] p-5 overflow-x-auto text-[13px] font-mono leading-relaxed">
            <code>{block.content}</code>
          </pre>
        </div>
      );
    case "image": {
      if (!block.content) return null;
      const src = block.content.startsWith("/static/") ? `${apiOrigin}${block.content}` : block.content;
      return (
        <figure className="flex flex-col items-center gap-2 my-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={block.caption || ""} className="max-w-full rounded-xl border border-border shadow-sm" />
          {block.caption && <figcaption className="text-xs text-muted-foreground text-center">{block.caption}</figcaption>}
        </figure>
      );
    }
    case "note":
      return (
        <div className="border-l-4 border-primary/50 bg-primary/5 rounded-r-xl px-4 py-3">
          <p className="text-sm text-muted-foreground italic leading-relaxed whitespace-pre-wrap">{block.content}</p>
        </div>
      );
    default:
      return <p className="text-sm text-foreground whitespace-pre-wrap">{block.content}</p>;
  }
}
