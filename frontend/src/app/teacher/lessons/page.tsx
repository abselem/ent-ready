"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Group {
  id: number;
  name: string;
}

interface Lesson {
  id: number;
  title: string;
  content: string;
  group_id: number;
  scheduled_at: string | null;
}

export default function TeacherLessonsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [groupId, setGroupId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState("");

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data,
  });

  const { data: lessons = [], isLoading } = useQuery<Lesson[]>({
    queryKey: ["teacher-lessons"],
    queryFn: async () => {
      const all = await Promise.all(
        groups.map((g) =>
          api.get(`/groups/${g.id}/lessons`).then((r) => r.data?.lessons ?? [])
        )
      );
      return all.flat();
    },
    enabled: groups.length > 0,
  });

  const createLesson = useMutation({
    mutationFn: (body: {
      title: string;
      content: string;
      group_id: number;
      scheduled_at?: string;
    }) => api.post(`/groups/${body.group_id}/lessons`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-lessons"] });
      setShowForm(false);
      setTitle("");
      setContent("");
      setGroupId("");
      setScheduledAt("");
      setError("");
    },
    onError: () => setError("Не удалось создать урок"),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) { setError("Выберите группу"); return; }
    createLesson.mutate({
      title,
      content,
      group_id: Number(groupId),
      ...(scheduledAt ? { scheduled_at: new Date(scheduledAt).toISOString() } : {}),
    });
  }

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Уроки</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Отмена" : "Создать урок"}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Новый урок</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <Input
                id="title"
                label="Название"
                placeholder="Тема урока"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="content" className="text-sm font-medium">Содержание</label>
                <textarea
                  id="content"
                  rows={4}
                  placeholder="Текст урока..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="border border-border rounded-md px-3 py-2 text-sm bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="group" className="text-sm font-medium">Группа</label>
                <select
                  id="group"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Выберите группу</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <Input
                id="scheduledAt"
                label="Дата и время (необязательно)"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" loading={createLesson.isPending}>Создать</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
      ) : lessons.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет уроков</div>
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson) => (
            <Card key={lesson.id}>
              <CardHeader>
                <CardTitle className="text-base">{lesson.title}</CardTitle>
                {lesson.scheduled_at && (
                  <CardContent className="p-0 mt-1 text-sm text-muted-foreground">
                    {formatDate(lesson.scheduled_at)}
                  </CardContent>
                )}
              </CardHeader>
              {lesson.content && (
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {lesson.content}
                  </p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
