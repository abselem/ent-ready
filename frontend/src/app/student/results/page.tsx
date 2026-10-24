"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { AsyncState } from "@/components/ui/async-state";
import { Button } from "@/components/ui/button";
import { scorePercent } from "@/lib/test-attempt-state";
import { api } from "@/lib/api";

interface Attempt {
  id: number;
  test_id: number;
  test_title: string;
  score: number | null;
  max_score: number | null;
  started_at: string;
  finished_at: string | null;
  topic_id: number | null;
  topic_name: string | null;
}

type Period = "all" | "today" | "week" | "month" | "3months";

const PERIODS: { value: Period; label: string }[] = [
  { value: "all",     label: "Всё время" },
  { value: "today",   label: "Сегодня" },
  { value: "week",    label: "7 дней" },
  { value: "month",   label: "Месяц" },
  { value: "3months", label: "3 месяца" },
];

function cutoffDate(period: Period): Date | null {
  if (period === "all") return null;
  const d = new Date();
  if (period === "today")   { d.setHours(0, 0, 0, 0); return d; }
  if (period === "week")    { d.setDate(d.getDate() - 7); return d; }
  if (period === "month")   { d.setMonth(d.getMonth() - 1); return d; }
  if (period === "3months") { d.setMonth(d.getMonth() - 3); return d; }
  return null;
}

function timeGroup(ts: string): string {
  const now = new Date();
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return "Ранее";
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  const diffDays = (day(now) - day(d)) / 86_400_000;
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  weekStart.setDate(weekStart.getDate() - (weekStart.getDay() + 6) % 7);
  if (d >= weekStart && d <= now) return "На этой неделе";
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return "В этом месяце";
  return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function formatDate(ts: string | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function StudentResultsPage() {
  const [period, setPeriod]       = useState<Period>("all");
  const [search, setSearch]       = useState("");
  const [topicFilter, setTopicFilter] = useState<number | "">("");

  const { data: attempts = [], isPending, isError, refetch } = useQuery<Attempt[]>({
    queryKey: ["student-attempts"],
    queryFn: async () => (await api.get("/attempts/my")).data ?? [],
  });

  // Unique topics from attempts
  const topics = useMemo(() =>
    Array.from(
      new Map(attempts.filter(a => a.topic_id != null).map(a => [a.topic_id!, a.topic_name ?? "Без названия"])).entries()
    ).sort(([, a], [, b]) => a.localeCompare(b, "ru")),
    [attempts]
  );

  // Summary covers only the loaded history, not all attempts on the server.
  const stats = useMemo(() => {
    const values = attempts.map(a => scorePercent(a.score, a.max_score)).filter((value): value is number => value !== null);
    if (!values.length) return null;
    return { total: attempts.length, avg: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), best: Math.max(...values) };
  }, [attempts]);

  // Filter
  const filtered = useMemo(() => {
    let result = attempts;
    const cut = cutoffDate(period);
    if (cut) result = result.filter(a => a.finished_at && new Date(a.finished_at) >= cut);
    if (topicFilter) result = result.filter(a => a.topic_id === topicFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(a =>
        a.test_title.toLowerCase().includes(q) ||
        (a.topic_name ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [attempts, period, topicFilter, search]);

  // Group by time period for display
  const grouped = useMemo(() => {
    const map = new Map<string, Attempt[]>();
    for (const a of filtered) {
      const g = a.finished_at ? timeGroup(a.finished_at) : "Ранее";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(a);
    }
    return Array.from(map.entries());
  }, [filtered]);

  function resetFilters() { setPeriod("all"); setSearch(""); setTopicFilter(""); }
  const controlClass = "min-h-11 w-full rounded-[10px] border border-control-border bg-card px-3 py-2 text-sm";
  return (
    <div className="page-shell space-y-6">
      <PageHeader title="Мои результаты" eyebrow="Моя подготовка" description="История завершённых тестов и доступный разбор ответов." />
      {!isPending && !isError && stats && <section aria-label="Сводка загруженной истории" className="space-y-3"><p className="text-sm text-muted-foreground">В загруженной истории · показатели до применения фильтров</p><div className="grid gap-3 min-[360px]:grid-cols-3">{[{ label: "Попыток загружено", value: stats.total }, { label: "Средний % от максимума", value: `${stats.avg}%` }, { label: "Лучший % от максимума", value: `${stats.best}%` }].map(item => <div key={item.label} className="surface p-4"><p className="text-2xl font-semibold tabular-nums">{item.value}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.label}</p></div>)}</div><p className="text-xs text-muted-foreground">Среднее и лучший результат рассчитаны по попыткам с известными баллами и положительным максимумом.</p></section>}
      <section aria-label="Фильтры результатов" className="surface space-y-4 p-5">
        <div><label htmlFor="result-search" className="mb-2 block text-sm font-medium">Найти тест или предмет</label><input id="result-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Название теста или предмета" className={controlClass} /></div>
        <div role="group" aria-label="Период" className="flex flex-wrap gap-2">{PERIODS.map(item => <Button key={item.value} variant={period === item.value ? "default" : "outline"} aria-pressed={period === item.value} onClick={() => setPeriod(item.value)}>{item.label}</Button>)}</div>
        {topics.length > 0 && <div><label htmlFor="result-topic" className="mb-2 block text-sm font-medium">Предмет</label><select id="result-topic" value={topicFilter} onChange={event => setTopicFilter(event.target.value ? Number(event.target.value) : "")} className={controlClass}><option value="">Все предметы</option>{topics.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>}
      </section>
      {isPending ? <AsyncState kind="loading" title="Загружаем историю…" /> : isError ? <AsyncState kind="error" title="Не удалось загрузить результаты" description="Проверьте соединение и повторите загрузку." onRetry={() => void refetch()} /> : attempts.length === 0 ? <AsyncState title="Нет завершённых тестов" description="После прохождения теста результат появится здесь." /> : filtered.length === 0 ? <div className="space-y-3"><AsyncState title="Ничего не найдено" description="Попробуйте изменить период, предмет или поисковый запрос." /><Button variant="outline" onClick={resetFilters}>Сбросить фильтры</Button></div> : <div className="space-y-7">{grouped.map(([group, items]) => <section key={group} className="space-y-3"><h2 className="text-base font-semibold">{group}</h2><div className="space-y-3">{items.map(attempt => {
        const percent = scorePercent(attempt.score, attempt.max_score);
        return <article key={attempt.id} className="surface p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1">{attempt.topic_name && <p className="mb-2 text-xs font-medium text-primary">{attempt.topic_name}</p>}<h3 className="break-words text-base font-semibold">{attempt.test_title}</h3><p className="mt-1 text-xs text-muted-foreground">{formatDate(attempt.finished_at)}</p></div><div><p className="text-lg font-semibold tabular-nums">{attempt.score ?? "—"} / {attempt.max_score ?? "—"} баллов</p>{percent !== null && <p className="mt-1 text-xs text-muted-foreground">{percent}% от максимального балла</p>}</div></div><Link href={`/student/results/${attempt.id}`} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-border px-4 text-sm font-medium hover:bg-muted">Открыть результат<span aria-hidden="true">→</span></Link></article>;
      })}</div></section>)}</div>}
      {!isPending && !isError && attempts.length > 0 && <p className="text-xs text-muted-foreground">Поиск и фильтры применяются к загруженной истории, которая может содержать не все ваши попытки.</p>}
    </div>
  );
}
