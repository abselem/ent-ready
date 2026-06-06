"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Group { id: number; name: string }
interface Lesson {
  id: number;
  title: string;
  description: { String: string; Valid: boolean } | null;
  group_id: number;
  scheduled_at: string | null;
  duration_min: number;
}

export default function TeacherLessonsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
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
        groups.map(g => api.get(`/groups/${g.id}/lessons`).then(r => (r.data ?? []) as Lesson[]))
      );
      return all.flat();
    },
    enabled: groups.length > 0,
  });

  const createLesson = useMutation({
    mutationFn: (body: { title: string; description: string; group_id: number; scheduled_at: string }) =>
      api.post(`/groups/${body.group_id}/lessons`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-lessons"] });
      setShowForm(false);
      setTitle(""); setDescription(""); setGroupId(""); setScheduledAt(""); setError("");
    },
    onError: () => setError("Не удалось создать урок"),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) { setError("Выберите группу"); return; }
    if (!scheduledAt) { setError("Укажите дату и время"); return; }
    createLesson.mutate({
      title,
      description,
      group_id: Number(groupId),
      scheduled_at: new Date(scheduledAt).toISOString(),
    });
  }

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const groupName = (gid: number) => groups.find(g => g.id === gid)?.name ?? "";

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Уроки</h1>
        <Button onClick={() => setShowForm(!showForm)} variant={showForm ? "outline" : "default"}>
          {showForm ? "Отмена" : "Создать урок"}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Новый урок</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <Input id="title" label="Название" placeholder="Тема урока"
                value={title} onChange={e => setTitle(e.target.value)} required />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Описание (необязательно)</label>
                <textarea
                  rows={2}
                  placeholder="Краткое описание..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="border border-border rounded-xl px-3 py-2 text-sm bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Группа</label>
                <select value={groupId} onChange={e => setGroupId(e.target.value)}
                  className="border border-border rounded-xl px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="">Выберите группу</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              <Input id="scheduledAt" label="Дата и время" type="datetime-local"
                value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} required />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" loading={createLesson.isPending}>Создать</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : lessons.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет уроков</div>
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson, idx) => (
            <div key={lesson.id} className="border border-border rounded-2xl bg-card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground shrink-0">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{lesson.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {groupName(lesson.group_id)}
                  {lesson.scheduled_at && ` · ${formatDate(lesson.scheduled_at)}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => router.push(`/teacher/lessons/${lesson.id}`)}
                className="shrink-0"
              >
                Редактировать
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
