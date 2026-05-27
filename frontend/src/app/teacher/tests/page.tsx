"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Group { id: number; name: string }
interface Topic { id: number; name: string }
interface Test {
  id: number;
  title: string;
  group_id: number | null;
  topic_id: number | null;
  is_published: boolean;
  is_public: boolean;
  max_attempts: number;
  time_limit: number | null;
}

export default function TeacherTestsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [groupId, setGroupId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [maxAttempts, setMaxAttempts] = useState("3");
  const [timeLimit, setTimeLimit] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [filterTopic, setFilterTopic] = useState<number | "">("");
  const [error, setError] = useState("");

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data,
  });

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data,
  });

  const { data: tests = [], isLoading } = useQuery<Test[]>({
    queryKey: ["teacher-tests"],
    queryFn: async () => (await api.get("/tests/mine")).data,
  });

  const createTest = useMutation({
    mutationFn: (body: object) => api.post("/tests", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-tests"] });
      setShowForm(false);
      setTitle(""); setGroupId(""); setTopicId(""); setTimeLimit(""); setIsPublic(false); setDeadline(""); setError("");
    },
    onError: () => setError("Не удалось создать тест"),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createTest.mutate({
      title,
      group_id: groupId ? Number(groupId) : null,
      topic_id: topicId ? Number(topicId) : null,
      max_attempts: Number(maxAttempts),
      time_limit: timeLimit ? Number(timeLimit) : null,
      is_public: isPublic,
      deadline: deadline ? new Date(deadline).toISOString() : null,
    });
  }

  const displayed = filterTopic
    ? tests.filter((t) => t.topic_id === filterTopic)
    : tests;

  // Group by topic
  type Group2 = { topicId: number | null; topicName: string | null; items: Test[] };
  const groups2: Group2[] = [];
  const seen = new Map<string, Group2>();
  for (const t of displayed) {
    const key = t.topic_id != null ? String(t.topic_id) : "null";
    if (!seen.has(key)) {
      const topicName = t.topic_id ? (topics.find((tp) => tp.id === t.topic_id)?.name ?? null) : null;
      const g: Group2 = { topicId: t.topic_id ?? null, topicName, items: [] };
      seen.set(key, g);
      groups2.push(g);
    }
    seen.get(key)!.items.push(t);
  }
  // Sort: topics first, then "no topic"
  groups2.sort((a, b) => {
    if (a.topicId == null && b.topicId != null) return 1;
    if (a.topicId != null && b.topicId == null) return -1;
    return (a.topicName ?? "").localeCompare(b.topicName ?? "", "ru");
  });

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Тесты</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Отмена" : "Создать тест"}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Новый тест</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <Input id="title" label="Название" placeholder="Контрольная №1"
                value={title} onChange={(e) => setTitle(e.target.value)} required />

              <div className="flex flex-col gap-1">
                <label htmlFor="group" className="text-sm font-medium">
                  Группа <span className="text-muted-foreground font-normal">(необязательно)</span>
                </label>
                <select id="group" value={groupId} onChange={(e) => setGroupId(e.target.value)}
                  className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="">Без группы</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="topic" className="text-sm font-medium">
                  Предмет ЕНТ <span className="text-muted-foreground font-normal">(необязательно)</span>
                </label>
                <select id="topic" value={topicId} onChange={(e) => setTopicId(e.target.value)}
                  className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="">Без предмета</option>
                  <optgroup label="ЕНТ">
                    {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                </select>
              </div>

              {/* Приватный / Публичный */}
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Доступ</span>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button type="button" onClick={() => setIsPublic(false)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${!isPublic ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                    Приватный
                  </button>
                  <button type="button" onClick={() => setIsPublic(true)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${isPublic ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                    Публичный
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isPublic ? "Любой ученик сможет пройти этот тест" : "Только участники группы"}
                </p>
              </div>

              <Input id="maxAttempts" label="Макс. попыток" type="number" min="1" max="10"
                value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />

              <Input id="timeLimit" label="Время прохождения (мин., 0 = без лимита)"
                type="number" min="0" placeholder="0"
                value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} />

              {groupId && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="deadline" className="text-sm font-medium">
                    Дедлайн <span className="text-muted-foreground font-normal">(необязательно)</span>
                  </label>
                  <input id="deadline" type="datetime-local" value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
                  <p className="text-xs text-muted-foreground">
                    После дедлайна не сдавшим автоматически выставляется 0 баллов, разбор ошибок открывается
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" loading={createTest.isPending}>Создать</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filter by topic */}
      {tests.length > 0 && (
        <div className="mb-4">
          <select value={filterTopic} onChange={(e) => setFilterTopic(e.target.value ? Number(e.target.value) : "")}
            className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary w-full">
            <option value="">Все предметы</option>
            <optgroup label="ЕНТ">
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет тестов</div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups2.map((g) => (
            <div key={g.topicId ?? "none"}>
              <div className="flex items-center gap-2 mb-2">
                {g.topicName ? (
                  <>
                    <span className="text-xs font-semibold text-primary uppercase tracking-wide">ЕНТ</span>
                    <h2 className="text-sm font-semibold text-foreground">{g.topicName}</h2>
                  </>
                ) : (
                  <h2 className="text-sm font-semibold text-muted-foreground">Без предмета</h2>
                )}
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="flex flex-col gap-3">
                {g.items.map((test) => (
                  <button key={test.id} onClick={() => router.push(`/teacher/tests/${test.id}`)} className="text-left w-full">
                    <Card className="hover:border-primary transition-colors cursor-pointer">
                      <CardHeader>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <CardTitle className="text-base">{test.title}</CardTitle>
                          <div className="flex gap-1.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${test.is_public ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>
                              {test.is_public ? "Публичный" : "Приватный"}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${test.is_published ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                              {test.is_published ? "Опубликован" : "Черновик"}
                            </span>
                          </div>
                        </div>
                        <CardContent className="p-0 mt-1 text-sm text-muted-foreground">
                          Попыток: {test.max_attempts}
                          {test.time_limit ? ` · ${test.time_limit} мин` : ""}
                        </CardContent>
                      </CardHeader>
                    </Card>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
