"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Group { id: number; name: string; category: string }
interface Topic { id: number; name: string }
interface Subtopic { id: number; topic_id: number; name: string }

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

type Visibility = "all" | "school" | "course" | "private";

const VISIBILITY_OPTS: { value: Visibility; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    value: "all", label: "Для всех", desc: "Все пользователи",
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/></svg>,
  },
  {
    value: "school", label: "Школа", desc: "Мои школьные группы",
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  },
  {
    value: "course", label: "Курс", desc: "Ученики моих курсов",
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  },
  {
    value: "private", label: "Приватный", desc: "Только явный доступ",
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  },
];

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
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("all");
  const [topicId, setTopicId] = useState<number | "">("");
  const [subtopicId, setSubtopicId] = useState<number | "">("");
  const [error, setError] = useState("");

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data,
  });

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data,
  });

  const { data: allSubtopics = [] } = useQuery<Subtopic[]>({
    queryKey: ["subtopics"],
    queryFn: async () => (await api.get("/subtopics")).data,
  });

  const subtopicsForTopic = topicId
    ? allSubtopics.filter(st => st.topic_id === Number(topicId))
    : [];

  const { data: lessons = [], isLoading } = useQuery<Lesson[]>({
    queryKey: ["teacher-lessons-mine"],
    queryFn: async () => (await api.get("/lessons/mine")).data,
  });

  const createLesson = useMutation({
    mutationFn: () => api.post("/lessons", {
      title,
      description,
      visibility,
      topic_id: topicId ? Number(topicId) : null,
      subtopic_id: subtopicId ? Number(subtopicId) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-lessons-mine"] });
      setShowForm(false);
      setTitle(""); setDescription(""); setVisibility("all"); setTopicId(""); setSubtopicId(""); setError("");
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
      <div className="flex items-center justify-between mb-6">
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
            <div className="flex flex-col gap-3">
              <Input id="title" label="Название" placeholder="Арифметика"
                value={title} onChange={e => setTitle(e.target.value)} required />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Описание</label>
                <textarea rows={3} placeholder="Краткое описание урока..."
                  value={description} onChange={e => setDescription(e.target.value)}
                  className="border border-border rounded-xl px-3 py-2 text-sm bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary" />
              </div>

              {/* Topic select */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Предмет (опционально)</label>
                <select
                  value={topicId}
                  onChange={e => {
                    setTopicId(e.target.value ? Number(e.target.value) : "");
                    setSubtopicId("");
                  }}
                  className="border border-border rounded-xl px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">— Не выбран —</option>
                  {topics.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              {/* Subtopic select */}
              {topicId && subtopicsForTopic.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Подтема (опционально)</label>
                  <select
                    value={subtopicId}
                    onChange={e => setSubtopicId(e.target.value ? Number(e.target.value) : "")}
                    className="border border-border rounded-xl px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">— Не выбрана —</option>
                    {subtopicsForTopic.map(st => (
                      <option key={st.id} value={st.id}>{st.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Visibility */}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Доступ после публикации</label>
                <div className="grid grid-cols-2 gap-2">
                  {VISIBILITY_OPTS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => setVisibility(opt.value)}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                        visibility === opt.value
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border bg-card hover:bg-muted text-foreground"
                      }`}>
                      <span className={visibility === opt.value ? "text-primary" : "text-muted-foreground"}>
                        {opt.icon}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button loading={createLesson.isPending} onClick={() => createLesson.mutate()}
                disabled={!title.trim() || !description.trim()}>
                Создать урок
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lessons list */}
      {isLoading ? (
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
                      <div className="flex items-center gap-2 shrink-0">
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
