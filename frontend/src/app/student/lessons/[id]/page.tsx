"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { AsyncState } from "@/components/ui/async-state";
import { LessonStepPlayer } from "@/components/lesson/step-player";
import type { LessonBlock } from "@/components/lesson/types";

interface Lesson {
  id: number;
  title: string;
  group_id: number | null;
  scheduled_at: string | null;
  duration_min: number;
  section_title: string | null;
  section_num: number;
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

  const { data: lesson, isError, isPending: lessonPending, refetch: refetchLesson } = useQuery<Lesson>({
    queryKey: ["lesson", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}`)).data,
    enabled: Number.isInteger(lessonId) && lessonId > 0,
  });

  const { data: groupLessons = [] } = useQuery<Lesson[]>({
    queryKey: ["group-lessons-sidebar", lesson?.group_id],
    queryFn: async () => (await api.get(`/groups/${lesson!.group_id}/lessons?limit=200`)).data ?? [],
    enabled: !!lesson?.group_id,
  });

  const { data: blocks = [], isLoading: blocksLoading, isError: blocksError, refetch: refetchBlocks } = useQuery<LessonBlock[]>({
    queryKey: ["lesson-blocks", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}/blocks`)).data ?? [],
    enabled: Number.isInteger(lessonId) && lessonId > 0,
  });

  // Record unique view once per lesson per user
  useEffect(() => {
    if (lesson?.id) api.post(`/lessons/${lesson.id}/view`).catch(() => {});
  }, [lesson?.id]);

  const sections = groupBySections(groupLessons);

  // Global lesson index for number display
  const sortedLessons = [...groupLessons].sort((a, b) => (a.section_num - b.section_num) || (a.order_num - b.order_num));
  const lessonIndex = sortedLessons.findIndex(l => l.id === lessonId);

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  }

  if (!Number.isInteger(lessonId) || lessonId <= 0 || isError) return <div className="page-shell"><AsyncState kind="error" title="Урок недоступен" onRetry={() => void refetchLesson()} /><Link className="mt-4 inline-flex min-h-11 items-center text-primary" href="/student/lessons">К списку уроков</Link></div>;
  if (lessonPending) return <div className="page-shell"><AsyncState kind="loading" title="Загружаем урок" /></div>;

  return (
    <div className="flex">
      {/* ── Sidebar ── */}
      {groupLessons.length > 0 && <aside className="hidden xl:flex flex-col w-64 shrink-0 border-r border-border bg-card sticky top-0 overflow-y-auto" style={{ height: "100vh" }}>
        {/* Back link */}
        <div className="px-4 py-3 border-b border-border">
          <Link href="/student/lessons"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6"/>
            </svg>
            Все уроки
          </Link>
        </div>

        {/* Sections + lessons */}
        <nav aria-label="Другие уроки группы" className="py-3 flex flex-col gap-0.5 overflow-y-auto flex-1">
          {sections.map((section) => (
            <div key={section.num}>
              {/* Section header */}
              {(section.title || sections.length > 1) && (
                <p className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                  {section.num}&nbsp;&nbsp;{section.title ?? `Раздел ${section.num}`}
                </p>
              )}
              {/* Lessons in section */}
              {[...section.lessons]
                .sort((a, b) => a.order_num - b.order_num)
                .map((l, li) => {
                  const isActive = l.id === lessonId;
                  return (
                    <Link
                      key={l.id}
                      href={`/student/lessons/${l.id}`}
                      className={`flex min-h-11 items-center gap-2.5 pl-4 pr-3 py-2 text-sm transition-colors relative ${
                        isActive
                          ? "bg-accent text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      {isActive && (
                        <span className="absolute right-0 top-0 bottom-0 w-0.5 bg-primary rounded-l" />
                      )}
                      <span className={`text-xs font-mono shrink-0 w-7 ${isActive ? "text-primary" : "text-muted-foreground"}`}>
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
      </aside>}

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0">
        <div className="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-8">

          {/* Mobile back */}
          <Link href="/student/lessons"
            className={`${groupLessons.length > 0 ? "xl:hidden" : ""} flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors`}>
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
              <h1 className="break-words text-2xl font-semibold leading-tight mb-1">{lesson.title}</h1>
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
          {blocksError ? <AsyncState kind="error" title="Не удалось загрузить содержимое урока" onRetry={() => void refetchBlocks()} /> : blocksLoading ? (
            <div className="flex flex-col gap-4">
              {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted/30 rounded-lg animate-pulse" />)}
            </div>
          ) : blocks.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              Содержимое урока пока не добавлено.
            </p>
          ) : (
            <LessonStepPlayer blocks={blocks} />
          )}

          {/* Prev / Next navigation */}
          {groupLessons.length > 1 && (
            <div className="flex flex-wrap items-center justify-between mt-10 pt-6 border-t border-border gap-3">
              {lessonIndex > 0 ? (
                <Link href={`/student/lessons/${sortedLessons[lessonIndex - 1]?.id}`}
                  className="flex min-h-11 min-w-0 items-center gap-2 break-words text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
                  {sortedLessons[lessonIndex - 1]?.title}
                </Link>
              ) : <span />}
              {lessonIndex >= 0 && lessonIndex < sortedLessons.length - 1 ? (
                <Link href={`/student/lessons/${sortedLessons[lessonIndex + 1]?.id}`}
                  className="flex min-h-11 min-w-0 items-center gap-2 break-words text-sm text-muted-foreground hover:text-foreground transition-colors ml-auto">
                  {sortedLessons[lessonIndex + 1]?.title}
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
