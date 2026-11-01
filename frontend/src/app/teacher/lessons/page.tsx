"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Lesson {
  id: number;
  title: string;
  description: string;
  group_id: number | null;
  scheduled_at: string | null;
  is_published: boolean;
  visibility: string;
  view_count: number;
  created_at: string;
  group_name: string;
  topic_id: number | null;
  topic_name: string;
  subtopic_id: number | null;
  subtopic_name: string;
}

const VISIBILITY_BADGE: Record<string, string> = {
  all:     "bg-green-500/10 text-green-400",
  school:  "bg-blue-500/10 text-blue-400",
  course:  "bg-purple-500/10 text-purple-400",
  private: "bg-yellow-500/10 text-yellow-400",
};

const VISIBILITY_LABEL: Record<string, string> = {
  all: "Для всех", school: "Школа", course: "Курс", private: "Приватный",
};

export default function TeacherLessonsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  const { data: lessons = [], isLoading, isError: lessonsError, refetch: refetchLessons } = useQuery<Lesson[]>({
    queryKey: ["teacher-lessons-mine"],
    queryFn: async () => (await api.get("/lessons/mine")).data ?? [],
  });

  const createLesson = useMutation({
    mutationFn: () => api.post("/lessons", { title: title.trim(), visibility: "private" }),
    onSuccess: ({ data }) => {
      qc.invalidateQueries({ queryKey: ["teacher-lessons-mine"] });
      router.push(`/teacher/lessons/${data.id}`);
    },
    onError: () => setError("Не удалось создать урок"),
  });

  const publishLesson = useMutation({
    mutationFn: ({ id, vis }: { id: number; vis: string }) =>
      api.post(`/lessons/${id}/publish`, { visibility: vis }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teacher-lessons-mine"] }),
  });

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Уроки</h1>
        <Button onClick={() => setShowForm(!showForm)} variant={showForm ? "outline" : "default"}>
          {showForm ? "Отмена" : "Создать урок"}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Новый урок</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={event => { event.preventDefault(); if (title.trim() && !createLesson.isPending) createLesson.mutate(); }} className="flex flex-col gap-4">
              <Input id="title" label="Название урока" placeholder="Например, Квадратные уравнения"
                value={title} onChange={event => setTitle(event.target.value)} required disabled={createLesson.isPending} maxLength={255} />
              <p className="text-sm text-muted-foreground">Создадим закрытый черновик. Затем добавьте шаги, настройте тему и выберите, кому будет доступен урок.</p>
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button type="submit" loading={createLesson.isPending} disabled={!title.trim()}>Создать черновик</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {publishLesson.isError && <p role="alert" className="mb-4 text-sm text-destructive">Не удалось опубликовать урок. Повторите попытку.</p>}
      {/* Lessons list */}
      {lessonsError ? (<div role="alert"><p>Не удалось загрузить уроки.</p><Button variant="outline" onClick={() => void refetchLessons()}>Повторить</Button></div>) : isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : lessons.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет уроков</div>
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(
            lessons.reduce((acc: Record<string, Lesson[]>, l) => {
              const key = l.topic_name || "Без предмета";
              if (!acc[key]) acc[key] = [];
              acc[key].push(l);
              return acc;
            }, {})
          ).map(([topicName, topicLessons]) => (
            <div key={topicName}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                {topicName}
              </h3>
              <div className="flex flex-col gap-2">
                {topicLessons.map((lesson) => (
                  <div key={lesson.id} className="border border-border rounded-2xl bg-card p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            lesson.is_published
                              ? "bg-green-500/10 text-green-400"
                              : "bg-muted text-muted-foreground"
                          }`}>
                            {lesson.is_published ? "Опубликован" : "Черновик"}
                          </span>
                          {lesson.is_published && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${VISIBILITY_BADGE[lesson.visibility] ?? ""}`}>
                              {VISIBILITY_LABEL[lesson.visibility] ?? lesson.visibility}
                            </span>
                          )}
                          {lesson.group_name && (
                            <span className="text-xs text-muted-foreground">{lesson.group_name}</span>
                          )}
                        </div>
                        <p className="font-medium text-sm">{lesson.title}</p>
                        {lesson.subtopic_name && (
                          <p className="text-xs text-muted-foreground mt-0.5">{lesson.subtopic_name}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{formatDate(lesson.created_at)}</span>
                          {lesson.is_published && (
                            <span className="flex items-center gap-1">
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                              </svg>
                              {lesson.view_count} просмотр{lesson.view_count === 1 ? "" : lesson.view_count < 5 ? "а" : "ов"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {!lesson.is_published && (
                          <Button size="sm" variant="outline"
                            onClick={() => publishLesson.mutate({ id: lesson.id, vis: lesson.visibility || "all" })}>
                            Опубликовать
                          </Button>
                        )}
                        <Button size="sm" variant="outline"
                          onClick={() => router.push(`/teacher/lessons/${lesson.id}`)}>
                          Редактировать
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
