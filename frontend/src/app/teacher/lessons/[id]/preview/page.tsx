"use client";

import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { AsyncState } from "@/components/ui/async-state";
import { LessonStepPlayer } from "@/components/lesson/step-player";
import type { LessonBlock } from "@/components/lesson/types";

interface Lesson { id: number; title: string; group_id: number | null; scheduled_at: string | null; duration_min: number }

export default function TeacherLessonPreview() {
  return <Suspense fallback={<div className="page-shell"><AsyncState kind="loading" title="Открываем предпросмотр" /></div>}><TeacherLessonPreviewContent /></Suspense>;
}

function TeacherLessonPreviewContent() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const lessonId = Number(id);
  const selectedStep = Number(searchParams.get("step"));
  const editorHref = `/teacher/lessons/${lessonId}${Number.isSafeInteger(selectedStep) && selectedStep > 0 ? `?step=${selectedStep}` : ""}`;
  const validId = Number.isInteger(lessonId) && lessonId > 0;
  const lessonQuery = useQuery<Lesson>({
    queryKey: ["lesson", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}`)).data,
    enabled: validId,
  });
  const blockQuery = useQuery<LessonBlock[]>({
    queryKey: ["lesson-blocks", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}/blocks`)).data ?? [],
    enabled: validId,
  });
  const lesson = lessonQuery.data;
  const { data: groupLessons = [] } = useQuery<Lesson[]>({
    queryKey: ["group-lessons-preview", lesson?.group_id],
    queryFn: async () => (await api.get(`/groups/${lesson!.group_id}/lessons?limit=100`)).data ?? [],
    enabled: !!lesson?.group_id,
  });

  if (!validId || lessonQuery.isError || blockQuery.isError) return <div className="page-shell"><AsyncState kind="error" title="Не удалось открыть предпросмотр урока" onRetry={() => { void lessonQuery.refetch(); void blockQuery.refetch(); }} /><Link className="mt-4 inline-flex min-h-11 items-center text-sm text-primary" href="/teacher/lessons">К списку уроков</Link></div>;
  if (lessonQuery.isPending || blockQuery.isPending) return <div className="page-shell"><AsyncState kind="loading" title="Загружаем предпросмотр" /></div>;

  return <div className="flex min-w-0">
    {groupLessons.length > 0 && <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
      <p className="border-b border-border px-4 py-4 text-sm font-medium">Уроки группы</p>
      <nav aria-label="Уроки группы в предпросмотре" className="space-y-1 p-2">
        {groupLessons.map((item, index) => <Link key={item.id} href={`/teacher/lessons/${item.id}/preview`} aria-current={item.id === lessonId ? "page" : undefined}
          className={`flex min-h-11 items-start gap-2 rounded-lg p-3 text-sm ${item.id === lessonId ? "bg-accent font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
          <span className="shrink-0">{index + 1}.</span><span className="min-w-0 break-words">{item.title}</span>
        </Link>)}
      </nav>
    </aside>}
    <div className="page-shell min-w-0 flex-1">
      <div className="mx-auto max-w-3xl">
        <Link href={editorHref} className="mb-5 inline-flex min-h-11 items-center text-sm text-primary">← Вернуться в редактор</Link>
        <div className="mb-6 rounded-xl border border-border bg-accent p-4 text-sm text-foreground">Предпросмотр — содержимое и переходы между шагами совпадают с ученическим режимом.</div>
        <header className="mb-6">
          <h1 className="break-words text-2xl font-semibold">{lesson?.title}</h1>
          {lesson?.scheduled_at && <p className="mt-2 text-sm text-muted-foreground">{new Date(lesson.scheduled_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}{lesson.duration_min > 0 ? ` · ${lesson.duration_min} мин` : ""}</p>}
        </header>
        <LessonStepPlayer blocks={blockQuery.data ?? []} />
      </div>
    </div>
  </div>;
}
