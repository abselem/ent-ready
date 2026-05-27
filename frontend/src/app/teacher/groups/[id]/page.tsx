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
  phone: string;
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
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const { data: group } = useQuery<Group>({
    queryKey: ["group", id],
    queryFn: async () => (await api.get(`/groups/${id}`)).data,
  });

  const { data: students = [], isLoading } = useQuery<Student[]>({
    queryKey: ["group-students", id],
    queryFn: async () => (await api.get(`/groups/${id}/students`)).data,
  });

  const addStudent = useMutation({
    mutationFn: (studentPhone: string) =>
      api.post(`/groups/${id}/students`, { phone: studentPhone }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group-students", id] });
      setPhone("");
      setError("");
    },
    onError: () => setError("Студент не найден или уже в группе"),
  });

  const removeStudent = useMutation({
    mutationFn: (studentId: number) =>
      api.delete(`/groups/${id}/students/${studentId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["group-students", id] }),
  });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    addStudent.mutate(phone);
  }

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
              onClick={() => navigator.clipboard.writeText(group.invite_code)}
              title="Копировать"
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
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              id="phone"
              label=""
              type="tel"
              placeholder="+79991234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
            <Button type="submit" loading={addStudent.isPending} className="shrink-0">
              Добавить
            </Button>
          </form>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        </CardContent>
      </Card>

      <h2 className="text-lg font-semibold mb-3">
        Студенты ({students.length})
      </h2>

      {isLoading ? (
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
                <p className="text-sm text-muted-foreground">{s.phone}</p>
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
