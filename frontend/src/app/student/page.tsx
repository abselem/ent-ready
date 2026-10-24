"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Topic { id: number; name: string }
interface Test {
  id: number;
  title: string;
  max_attempts: number;
  is_published: boolean;
  time_limit: number | null;
}
interface Group { id: number; name: string }

const symbols: Record<string, string> = {
  "Математика": "∑", "Физика": "Ф", "Химия": "Х", "Биология": "Б",
  "География": "Г", "Информатика": "⌘", "Всемирная история": "И",
  "Основы права и экономики": "§", "Английский язык": "EN", "Французский язык": "FR",
  "Немецкий язык": "DE", "Казахская литература": "Қ", "Русская литература": "Р",
};
const actionClass = "inline-flex min-h-11 items-center justify-center rounded-xl border border-control-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

export default function StudentHomePage() {
  const [search, setSearch] = useState("");
  const topicsQuery = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data ?? [],
  });
  const groupsQuery = useQuery<Group[]>({
    queryKey: ["joined-groups-home"],
    queryFn: async () => (await api.get("/groups/joined")).data ?? [],
  });
  const groupQueries = useQueries({
    queries: (groupsQuery.data ?? []).map((group) => ({
      queryKey: ["student-assigned-tests", group.id],
      queryFn: async (): Promise<Test[]> => (await api.get(`/groups/${group.id}/tests`)).data ?? [],
    })),
  });
  const tests = [...new Map(groupQueries.flatMap((query) => query.data ?? [])
    .filter((test) => test.is_published).map((test) => [test.id, test])).values()];
  const assignmentsLoading = groupsQuery.isPending || groupQueries.some((query) => query.isPending);
  const assignmentsError = groupsQuery.isError || groupQueries.some((query) => query.isError);
  const topics = topicsQuery.data ?? [];
  const filteredTopics = topics.filter((topic) => topic.name.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru")));

  function retryAssignments() {
    if (groupsQuery.isError) void groupsQuery.refetch();
    groupQueries.forEach((query) => { if (query.isError) void query.refetch(); });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">Учебное пространство</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Мои тесты</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Откройте назначенный тест или выберите предмет для самостоятельной тренировки.</p>
      </header>

      <section aria-labelledby="assigned-title" className="space-y-4">
        <h2 id="assigned-title" className="text-xl font-semibold">Назначенные тесты</h2>
        {assignmentsError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-card p-4">
            <p className="max-w-xl text-sm text-destructive">Не удалось загрузить часть назначений. Доступные тесты показаны ниже.</p>
            <Button variant="outline" onClick={retryAssignments}>Повторить загрузку</Button>
          </div>
        )}
        {assignmentsLoading && <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Загружаем назначения…</p>}
        {tests.length > 0 && <div className="grid gap-3 md:grid-cols-2">
          {tests.map((test) => (
            <article key={test.id} className="flex min-w-0 flex-col items-start rounded-2xl border border-border bg-card p-5">
              <span className="mb-3 rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Назначенный тест</span>
              <h3 className="break-words text-base font-semibold">{test.title}</h3>
              <p className="mb-5 mt-2 text-sm text-muted-foreground">Максимум попыток: {test.max_attempts}{typeof test.time_limit === "number" && test.time_limit > 0 ? ` · ${test.time_limit} мин` : ""}</p>
              <Link href={`/student/tests/${test.id}`} className={`${actionClass} mt-auto`}>Открыть тест <span aria-hidden="true" className="ml-3">→</span></Link>
            </article>
          ))}
        </div>}
        {!assignmentsLoading && !assignmentsError && tests.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6">
            <p className="font-medium">Назначенных тестов пока нет</p>
            <p className="mt-1 text-sm text-muted-foreground">Можно выбрать предмет для тренировки.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="subjects-title" className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 id="subjects-title" className="text-xl font-semibold">Тренировка по предметам</h2><p className="mt-1 text-sm text-muted-foreground">Выберите направление и занимайтесь в своём темпе.</p></div>
          <Link href="/student/ent" className={actionClass}>Подготовка к ЕНТ <span aria-hidden="true" className="ml-3">→</span></Link>
        </div>
        <div className="max-w-md">
          <label htmlFor="subject-search" className="mb-2 block text-sm font-medium">Найти предмет</label>
          <input id="subject-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название предмета" className="min-h-11 w-full rounded-xl border border-control-border bg-card px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" />
        </div>
        {topicsQuery.isPending ? <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Загружаем предметы…</p> : topicsQuery.isError ? (
          <div role="alert" className="rounded-2xl border border-destructive/30 bg-card p-6"><p className="mb-3 text-sm text-destructive">Не удалось загрузить предметы.</p><Button variant="outline" onClick={() => void topicsQuery.refetch()}>Повторить загрузку</Button></div>
        ) : topics.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">Предметов для тренировки пока нет.</p>
        ) : filteredTopics.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6"><p className="font-medium">Ничего не найдено</p><p className="mb-3 mt-1 text-sm text-muted-foreground">Попробуйте другое название предмета.</p><Button variant="outline" onClick={() => setSearch("")}>Сбросить поиск</Button></div>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {filteredTopics.map((topic) => (
              <Link key={topic.id} href={`/student/subjects/${topic.id}`} className="group flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-semibold text-primary">{symbols[topic.name] ?? topic.name.slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0"><h3 className="break-words text-sm font-medium leading-relaxed">{topic.name}</h3><p className="mt-1 text-xs text-muted-foreground">Открыть тренировки <span aria-hidden="true">→</span></p></div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
