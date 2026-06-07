"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { api, apiOrigin } from "@/lib/api";

interface Lesson {
  id: number;
  title: string;
  group_id: number;
  scheduled_at: string | null;
  duration_min: number;
  section_title: string | null;
  section_num: number;
  order_num: number;
}

interface Block {
  id: number;
  type: string;
  content: string;
  language: string;
  caption: string;
  order_num: number;
}

interface Section {
  num: number;
  title: string | null;
  lessons: Lesson[];
}

function groupBySections(lessons: Lesson[]): Section[] {
  const map = new Map<number, Section>();
  for (const l of lessons) {
    const num = l.section_num ?? 1;
    if (!map.has(num)) map.set(num, { num, title: l.section_title ?? null, lessons: [] });
    map.get(num)!.lessons.push(l);
  }
  return Array.from(map.values()).sort((a, b) => a.num - b.num);
}

export default function StudentLessonPage() {
  const { id } = useParams();
  const lessonId = Number(id);
  const router = useRouter();

  const { data: lesson, isError } = useQuery<Lesson>({
    queryKey: ["lesson", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}`)).data,
    enabled: !!lessonId,
  });

  useEffect(() => { if (isError) router.push("/student/lessons"); }, [isError, router]);

  const { data: groupLessons = [] } = useQuery<Lesson[]>({
    queryKey: ["group-lessons-sidebar", lesson?.group_id],
    queryFn: async () => (await api.get(`/groups/${lesson!.group_id}/lessons?limit=200`)).data,
    enabled: !!lesson?.group_id,
  });

  const { data: blocks = [], isLoading: blocksLoading } = useQuery<Block[]>({
    queryKey: ["lesson-blocks", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}/blocks`)).data,
    enabled: !!lessonId,
  });

  // Record unique view once per lesson per user
  useEffect(() => {
    if (lessonId) api.post(`/lessons/${lessonId}/view`).catch(() => {});
  }, [lessonId]);

  const sections = groupBySections(groupLessons);

  // Global lesson index for number display
  const lessonIndex = groupLessons
    .sort((a, b) => (a.section_num - b.section_num) || (a.order_num - b.order_num))
    .findIndex(l => l.id === lessonId);

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  }

  return (
    <div className="flex">
      {/* ── Sidebar ── */}
      <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-[#0f172a] sticky top-0 overflow-y-auto" style={{ height: "100vh" }}>
        {/* Back link */}
        <div className="px-4 py-3 border-b border-white/10">
          <Link href="/student/lessons"
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Все уроки
          </Link>
        </div>

        {/* Sections + lessons */}
        <nav className="py-3 flex flex-col gap-0.5 overflow-y-auto flex-1">
          {sections.map((section) => (
            <div key={section.num}>
              {/* Section header */}
              {(section.title || sections.length > 1) && (
                <p className="px-4 pt-3 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-widest">
                  {section.num}&nbsp;&nbsp;{section.title ?? `Раздел ${section.num}`}
                </p>
              )}
              {/* Lessons in section */}
              {section.lessons
                .sort((a, b) => a.order_num - b.order_num)
                .map((l, li) => {
                  const isActive = l.id === lessonId;
                  return (
                    <Link
                      key={l.id}
                      href={`/student/lessons/${l.id}`}
                      className={`flex items-center gap-2.5 pl-4 pr-3 py-1.5 text-sm transition-colors relative ${
                        isActive
                          ? "bg-primary/20 text-primary-foreground font-medium"
                          : "text-slate-400 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-primary rounded-l" />
                      )}
                      <span className={`text-xs font-mono shrink-0 w-7 ${isActive ? "text-primary" : "text-slate-500"}`}>
                        {section.num}.{li + 1}
                      </span>
                      <span className="truncate leading-snug">{l.title}</span>
                      {isActive && (
                        <svg className="w-3 h-3 text-primary shrink-0 ml-auto" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      )}
                    </Link>
                  );
                })}
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0">
        <div className="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">

          {/* Mobile back */}
          <Link href="/student/lessons"
            className="md:hidden flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Все уроки
          </Link>

          {/* Lesson header */}
          {lesson && (
            <div className="mb-8">
              {lesson.section_title && (
                <p className="text-xs font-medium text-primary uppercase tracking-wide mb-1">
                  {lesson.section_num}.{lesson.order_num}&nbsp; {lesson.section_title}
                </p>
              )}
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

          {/* Blocks */}
          {blocksLoading ? (
            <div className="flex flex-col gap-4">
              {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted/30 rounded-lg animate-pulse" />)}
            </div>
          ) : blocks.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              Содержимое урока пока не добавлено.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {blocks.map(block => <BlockView key={block.id} block={block} />)}
            </div>
          )}

          {/* Prev / Next navigation */}
          {groupLessons.length > 1 && (
            <div className="flex items-center justify-between mt-10 pt-6 border-t border-border gap-3">
              {lessonIndex > 0 ? (
                <Link href={`/student/lessons/${groupLessons[lessonIndex - 1]?.id}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
                  {groupLessons[lessonIndex - 1]?.title}
                </Link>
              ) : <span />}
              {lessonIndex < groupLessons.length - 1 ? (
                <Link href={`/student/lessons/${groupLessons[lessonIndex + 1]?.id}`}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors ml-auto">
                  {groupLessons[lessonIndex + 1]?.title}
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6"/></svg>
                </Link>
              ) : <span />}
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
