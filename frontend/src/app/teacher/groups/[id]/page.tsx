"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Student {
  id: number;
  first_name: string;
  last_name: string;
}

interface Group {
  id: number;
  name: string;
  city: string;
  school: string;
  invite_code: string;
}

export default function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [studentId, setStudentId] = useState("");
  const [error, setError] = useState("");

  const { data: group, isLoading: groupLoading, isError: groupError, refetch: refetchGroup } = useQuery<Group>({
    queryKey: ["group", id],
    queryFn: async () => (await api.get(`/groups/${id}`)).data,
  });

  const { data: students = [], isLoading, isError: studentsError, refetch: refetchStudents } = useQuery<Student[]>({
    queryKey: ["group-students", id],
    queryFn: async () => (await api.get(`/groups/${id}/students`)).data ?? [],
  });

  const addStudent = useMutation({
    mutationFn: (userId: number) =>
      api.post(`/groups/${id}/students`, { user_id: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group-students", id] });
      setStudentId("");
      setError("");
    },
    onError: () => setError("Не удалось добавить ученика. Проверьте ID и состав группы."),
  });

  const removeStudent = useMutation({
    mutationFn: (studentId: number) =>
      api.delete(`/groups/${id}/students/${studentId}`),
    onSuccess: () => { setError(""); qc.invalidateQueries({ queryKey: ["group-students", id] }); },
    onError: () => setError("Не удалось удалить ученика. Повторите попытку."),
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const userId = Number(studentId);
    if (!Number.isSafeInteger(userId) || userId <= 0) { setError("Укажите положительный числовой ID ученика."); return; }
    addStudent.mutate(userId);
  }

  if (groupLoading) return <div className="page-shell">Загружаем группу…</div>;
  if (groupError || !group) return <div className="page-shell"><p role="alert">Не удалось открыть группу.</p><Button onClick={() => void refetchGroup()}>Повторить</Button></div>;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{group?.name ?? "Группа"}</h1>
        {group && (
          <p className="text-sm text-muted-foreground mt-0.5">{group.school} · {group.city}</p>
        )}
        {group?.invite_code && (
          <div className="mt-3 inline-flex items-center gap-3 border border-border rounded-lg px-4 py-2.5 bg-muted/50">
            <div>
              <p className="text-xs text-muted-foreground leading-none mb-1">Код для вступления</p>
              <p className="font-mono font-bold text-xl tracking-widest text-primary">{group.invite_code}</p>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { void navigator.clipboard.writeText(group.invite_code).catch(() => setError("Не удалось скопировать код. Выделите и скопируйте его вручную.")); }}
              title="Копировать"
              aria-label="Копировать код вступления"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Добавить студента</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col items-start gap-2 sm:flex-row sm:items-end">
            <Input
              id="student-id"
              label="ID ученика"
              type="number"
              min={1}
              step={1}
              placeholder="Например, 42"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
            />
            <Button type="submit" loading={addStudent.isPending} className="shrink-0">
              Добавить
            </Button>
          </form>
          <p className="mt-3 text-sm text-muted-foreground">Можно также передать ученику код вступления, показанный выше.</p>
          {error && <p role="alert" className="text-sm text-destructive mt-2">{error}</p>}
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold mb-3">
        Студенты ({students.length})
      </h2>

      {studentsError ? (<div role="alert"><p>Не удалось загрузить учеников.</p><Button variant="outline" onClick={() => void refetchStudents()}>Повторить</Button></div>) : isLoading ? (
        <div className="text-muted-foreground">Загрузка...</div>
      ) : students.length === 0 ? (
        <div className="text-muted-foreground">Нет студентов в группе</div>
      ) : (
        <div className="flex flex-col gap-2">
          {students.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
            >
              <div>
                <p className="font-medium">{s.first_name} {s.last_name}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeStudent.mutate(s.id)}
                loading={removeStudent.isPending}
              >
                Удалить
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
