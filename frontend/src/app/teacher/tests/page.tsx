"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
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
  const statusRef = useRef<HTMLParagraphElement>(null);
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
  const [success, setSuccess] = useState("");

  const { data: groups = [], isLoading: groupsLoading, isError: groupsError, refetch: refetchGroups } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data ?? [],
  });

  const { data: topics = [], isLoading: topicsLoading, isError: topicsError, refetch: refetchTopics } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data ?? [],
  });

  const { data: tests = [], isLoading, isError, refetch } = useQuery<Test[]>({
    queryKey: ["teacher-tests"],
    queryFn: async () => (await api.get("/tests/mine")).data ?? [],
  });

  const createTest = useMutation({
    mutationFn: (body: object) => api.post("/tests", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teacher-tests"] });
      setSuccess(`Тест «${title}» создан как черновик. Откройте его, чтобы добавить вопросы.`);
      requestAnimationFrame(() => statusRef.current?.focus());
      setShowForm(false);
      setTitle(""); setGroupId(""); setTopicId(""); setTimeLimit(""); setIsPublic(false); setDeadline(""); setError("");
    },
    onError: () => setError("Не удалось создать тест"),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
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
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="mb-2 text-sm font-medium text-muted-foreground">Рабочее пространство учителя</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Мои тесты</h1><p className="mt-2 text-sm text-muted-foreground">Создавайте задания и управляйте их публикацией.</p></div>
        <Button aria-expanded={showForm} aria-controls="test-create" disabled={createTest.isPending} onClick={() => setShowForm(!showForm)}>
          {showForm ? "Закрыть форму" : "Создать тест"}
        </Button>
      </div>
      <p ref={statusRef} tabIndex={-1} role="status" className={success ? "rounded-xl border border-border bg-accent p-4 text-sm" : "sr-only"}>{success}</p>

      {showForm && (
        <Card id="test-create" className="max-w-3xl">
          <CardHeader><CardTitle>Новый тест</CardTitle><p className="mt-1 text-sm text-muted-foreground">Создайте черновик, затем добавьте вопросы и опубликуйте тест.</p></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-5">
              <Input id="title" label="Название" placeholder="Контрольная №1"
                value={title} onChange={(e) => setTitle(e.target.value)} required />

              <div className="flex flex-col gap-1">
                <label htmlFor="group" className="text-sm font-medium">
                  Группа <span className="text-muted-foreground font-normal">(необязательно)</span>
                </label>
                <select id="group" disabled={groupsLoading || groupsError} value={groupId} onChange={(e) => { setGroupId(e.target.value); if (!e.target.value) setDeadline(""); }}
                  className="min-h-11 border border-control-border rounded-xl px-3 py-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="">{groupsLoading ? "Загружаем группы…" : "Без группы"}</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="topic" className="text-sm font-medium">
                  Предмет ЕНТ <span className="text-muted-foreground font-normal">(необязательно)</span>
                </label>
                <select id="topic" disabled={topicsLoading || topicsError} value={topicId} onChange={(e) => setTopicId(e.target.value)}
                  className="min-h-11 border border-control-border rounded-xl px-3 py-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value="">{topicsLoading ? "Загружаем предметы…" : "Без предмета"}</option>
                  <optgroup label="ЕНТ">
                    {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </optgroup>
                </select>
              </div>

              {groupsError && <div role="alert" className="text-sm text-destructive">Не удалось загрузить группы. <button type="button" className="min-h-11 underline" onClick={() => refetchGroups()}>Повторить</button></div>}
              {topicsError && <div role="alert" className="text-sm text-destructive">Не удалось загрузить предметы. <button type="button" className="min-h-11 underline" onClick={() => refetchTopics()}>Повторить</button></div>}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-2 text-sm font-medium text-foreground">Публичный доступ</legend>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  <button type="button" aria-pressed={!isPublic} onClick={() => setIsPublic(false)}
                    className={`min-h-11 flex-1 px-3 py-2 text-sm font-medium transition-colors ${!isPublic ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                    Не публичный
                  </button>
                  <button type="button" aria-pressed={isPublic} onClick={() => setIsPublic(true)}
                    className={`min-h-11 flex-1 px-3 py-2 text-sm font-medium transition-colors ${isPublic ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                    Публичный
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isPublic ? "После публикации тест будет доступен всем ученикам." : "Публичный доступ выключен. Доступ учеников зависит от назначения группе и публикации."}
                </p>
              </fieldset>

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
                    className="min-h-11 border border-control-border rounded-xl px-3 py-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
                  <p className="text-xs text-muted-foreground">
                    После дедлайна не сдавшим автоматически выставляется 0 баллов, разбор ошибок открывается
                  </p>
                </div>
              )}

              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <div className="flex flex-wrap gap-3"><Button type="submit" loading={createTest.isPending}>Создать черновик</Button><Button type="button" variant="ghost" disabled={createTest.isPending} onClick={() => setShowForm(false)}>Отмена</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filter by topic */}
      {tests.length > 0 && (
        <div className="mb-4 max-w-sm">
          <label htmlFor="filter-topic" className="mb-2 block text-sm font-medium">Предмет</label>
          <select id="filter-topic" disabled={topicsLoading || topicsError} value={filterTopic} onChange={(e) => setFilterTopic(e.target.value ? Number(e.target.value) : "")}
            className="min-h-11 border border-control-border rounded-xl px-3 py-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary w-full">
            <option value="">Все предметы</option>
            <optgroup label="ЕНТ">
              {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          </select>
          {topicsError && <p role="alert" className="text-sm text-muted-foreground">Не удалось загрузить предметы. <button className="min-h-11 underline" onClick={() => refetchTopics()}>Повторить</button></p>}
          <p role="status" className="mt-2 text-xs text-muted-foreground">Найдено тестов: {displayed.length}</p>
        </div>
      )}

      {isLoading ? (
        <div role="status" className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">Загружаем тесты…</div>
      ) : isError ? (
        <Card><p role="alert" className="mb-4 text-sm">Не удалось загрузить тесты.</p><Button variant="outline" onClick={() => refetch()}>Повторить</Button></Card>
      ) : displayed.length === 0 ? (
        <Card className="py-10 text-center"><CardTitle>{tests.length === 0 ? "Пока нет тестов" : "Тесты не найдены"}</CardTitle><p className="mt-2 text-sm text-muted-foreground">{tests.length === 0 ? "Создайте черновик и добавьте первые вопросы." : "По выбранному предмету пока нет тестов."}</p><Button variant="outline" className="mt-5" onClick={() => tests.length === 0 ? setShowForm(true) : setFilterTopic("")}>{tests.length === 0 ? "Создать тест" : "Сбросить фильтр"}</Button></Card>
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
                  <h2 className="text-sm font-semibold text-muted-foreground">{g.topicId == null ? "Без предмета" : "Предмет"}</h2>
                )}
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="flex flex-col gap-3">
                {g.items.map((test) => (
                  <Link key={test.id} href={`/teacher/tests/${test.id}`} className="text-left w-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                    <Card className="hover:border-primary transition-colors cursor-pointer">
                      <CardHeader>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <CardTitle className="break-words text-base">{test.title}</CardTitle>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                              {test.is_public ? "Публичный" : "Не публичный"}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded-md ${test.is_published ? "bg-accent text-primary" : "bg-muted text-muted-foreground"}`}>
                              {test.is_published ? "Опубликован" : "Черновик"}
                            </span>
                          </div>
                        </div>
                        <CardContent className="p-0 mt-1 text-sm text-muted-foreground">
                          Максимум попыток: {test.max_attempts}
                          {test.time_limit != null && test.time_limit > 0 ? ` · ${test.time_limit} мин` : " · Без ограничения времени"}
                          <span className="mt-4 block font-medium text-primary">Открыть тест →</span>
                        </CardContent>
                      </CardHeader>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
