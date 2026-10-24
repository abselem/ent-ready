"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { AsyncState } from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";

interface Topic { id: number; name: string }
interface Subtopic { id: number; name: string; topic_id: number }
interface TestWithAuthor { id: number; title: string; description: string; max_attempts: number; time_limit: number | null; author_name: string }

export default function SubjectPage() {
  const router = useRouter();
  const params = useParams();
  const topicId = Number(params.id);
  const [subtopicFilter, setSubtopicFilter] = useState<number | null>(null);
  const [loadingRandom, setLoadingRandom] = useState(false);
  const [randomError, setRandomError] = useState("");
  const topicsQuery = useQuery<Topic[]>({ queryKey: ["topics"], queryFn: async () => (await api.get("/topics")).data ?? [] });
  const subtopicsQuery = useQuery<Subtopic[]>({ queryKey: ["subtopics", topicId], queryFn: async () => (await api.get(`/topics/${topicId}/subtopics`)).data ?? [], enabled: !!topicId });
  const testsQuery = useQuery<TestWithAuthor[]>({ queryKey: ["topic-tests", topicId], queryFn: async () => (await api.get(`/topics/${topicId}/tests`)).data ?? [], enabled: !!topicId });
  const topic = topicsQuery.data?.find((item) => item.id === topicId);

  async function handleRandomTest() {
    setLoadingRandom(true);
    setRandomError("");
    try {
      const { data } = await api.post(`/topics/${topicId}/random-test`);
      if (!data.test_id) { setRandomError("Не удалось создать тренировку. Попробуйте ещё раз позже."); return; }
      router.push(`/student/tests/${data.test_id}`);
    } catch (error: unknown) {
      const response = (error as { response?: { status?: number; data?: { error?: string } } })?.response;
      setRandomError(response?.status === 400 && response.data?.error === "no questions available for this topic" ? "Нет доступных вопросов по этому предмету. Можно выбрать опубликованный тест ниже." : "Не удалось создать тренировку. Проверьте соединение и попробуйте ещё раз.");
    } finally { setLoadingRandom(false); }
  }

  return (
    <div className="page-shell space-y-6">
      <Link href="/student" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><span aria-hidden="true">←</span>К предметам</Link>
      <PageHeader title={topic?.name ?? "Тренировка по предмету"} eyebrow="Моя подготовка" description="Выберите опубликованный тест или создайте тренировку из доступного банка вопросов." />
      {topicsQuery.isPending && <p role="status" className="text-sm text-muted-foreground">Загружаем название предмета…</p>}
      {topicsQuery.isError && <AsyncState kind="error" title="Не удалось загрузить название предмета" onRetry={() => void topicsQuery.refetch()} />}
      <section aria-labelledby="random-test-title" className="surface p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-xl"><span className="mb-3 inline-flex rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Самостоятельная практика</span><h2 id="random-test-title" className="text-xl font-semibold">Случайный тест</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Вопросы по этому предмету подбираются из доступного банка. Состав зависит от наличия вопросов.</p></div>
          <Button onClick={handleRandomTest} loading={loadingRandom} disabled={loadingRandom} aria-busy={loadingRandom}>{loadingRandom ? "Создаём тренировку…" : "Создать тренировку"}</Button>
        </div>
        {randomError && <p role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive">{randomError}</p>}
      </section>
      {subtopicsQuery.isPending && <p role="status" className="text-sm text-muted-foreground">Загружаем темы предмета…</p>}
      {subtopicsQuery.isError && <AsyncState kind="error" title="Не удалось загрузить темы предмета" description="Опубликованные тесты доступны независимо от этого списка." onRetry={() => void subtopicsQuery.refetch()} />}
      {(subtopicsQuery.data ?? []).length > 0 && <section aria-label="Темы предмета" className="space-y-3"><h2 className="text-sm font-medium">Темы предмета</h2><div className="flex flex-wrap gap-2"><Button variant={subtopicFilter === null ? "default" : "outline"} aria-pressed={subtopicFilter === null} onClick={() => setSubtopicFilter(null)}>Все</Button>{subtopicsQuery.data?.map((item) => <Button key={item.id} variant={subtopicFilter === item.id ? "default" : "outline"} aria-pressed={subtopicFilter === item.id} onClick={() => setSubtopicFilter(item.id === subtopicFilter ? null : item.id)} className="h-auto whitespace-normal text-left">{item.name}</Button>)}</div><p className="text-xs text-muted-foreground">Ниже показаны все опубликованные тесты предмета.</p></section>}
      <section aria-labelledby="subject-tests-title" className="space-y-4">
        <h2 id="subject-tests-title" className="text-xl font-semibold">Опубликованные тесты</h2>
        {testsQuery.isPending ? <AsyncState kind="loading" title="Загружаем тесты…" /> : testsQuery.isError ? <AsyncState kind="error" title="Не удалось загрузить тесты" onRetry={() => void testsQuery.refetch()} /> : (testsQuery.data ?? []).length === 0 ? <AsyncState title="Опубликованных тестов пока нет" description="Можно попробовать создать случайную тренировку из доступных вопросов." /> : <div className="grid gap-3 md:grid-cols-2">{testsQuery.data?.map((test) => <article key={test.id} className="surface flex min-w-0 flex-col items-start p-5"><h3 className="break-words text-base font-semibold">{test.title}</h3>{test.description && <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{test.description}</p>}<p className="mt-3 text-xs text-muted-foreground">Максимум попыток: {test.max_attempts}{typeof test.time_limit === "number" && test.time_limit > 0 ? ` · ${test.time_limit} мин` : ""}</p>{test.author_name && <p className="mt-1 text-xs text-muted-foreground">Автор: {test.author_name}</p>}<Link href={`/student/tests/${test.id}`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-border px-4 text-sm font-medium hover:bg-muted">Открыть тест<span aria-hidden="true">→</span></Link></article>)}</div>}
      </section>
    </div>
  );
}
