"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
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
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return "Сегодня";
  if (diffDays === 1) return "Вчера";
  if (diffDays < 7)  return "На этой неделе";
  if (diffDays < 30) return "В этом месяце";
  return d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
}

function pct(score: number | null, max: number | null) {
  if (!max) return 0;
  return Math.round(((score ?? 0) / max) * 100);
}

function scoreColor(p: number) {
  if (p >= 80) return { bar: "bg-green-500", text: "text-green-500" };
  if (p >= 50) return { bar: "bg-yellow-500", text: "text-yellow-500" };
  return { bar: "bg-destructive", text: "text-destructive" };
}

function formatDate(ts: string | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function StudentResultsPage() {
  const router = useRouter();
  const [period, setPeriod]       = useState<Period>("all");
  const [search, setSearch]       = useState("");
  const [topicFilter, setTopicFilter] = useState<number | "">("");

  const { data: attempts = [], isLoading } = useQuery<Attempt[]>({
    queryKey: ["student-attempts"],
    queryFn: async () => (await api.get("/attempts/my")).data,
  });

  // Unique topics from attempts
  const topics = useMemo(() =>
    Array.from(
      new Map(attempts.filter(a => a.topic_id != null).map(a => [a.topic_id!, a.topic_name!])).entries()
    ).sort(([, a], [, b]) => a.localeCompare(b, "ru")),
    [attempts]
  );

  // Stats
  const stats = useMemo(() => {
    const finished = attempts.filter(a => a.max_score);
    if (!finished.length) return null;
    const avg = Math.round(finished.reduce((s, a) => s + pct(a.score, a.max_score), 0) / finished.length);
    const best = Math.max(...finished.map(a => pct(a.score, a.max_score)));
    return { total: finished.length, avg, best };
  }, [attempts]);

  // Filter
  const filtered = useMemo(() => {
    let result = attempts;
    const cut = cutoffDate(period);
    if (cut) result = result.filter(a => a.finished_at && new Date(a.finished_at) >= cut);
    if (topicFilter) result = result.filter(a => a.topic_id === topicFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
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

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-5">Мои результаты</h1>

      {/* Stats summary */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: "Всего тестов", value: stats.total },
            { label: "Средний балл", value: `${stats.avg}%` },
            { label: "Лучший результат", value: `${stats.best}%` },
          ].map(s => (
            <div key={s.label} className="border border-border rounded-xl p-3 bg-card text-center">
              <p className="text-lg font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию теста или предмету..."
          className="w-full border border-border rounded-xl pl-9 pr-4 py-2.5 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Time period chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 mb-3 scrollbar-none">
        {PERIODS.map(p => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              period === p.value
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Topic filter */}
      {topics.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-5 scrollbar-none">
          <button
            onClick={() => setTopicFilter("")}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              topicFilter === ""
                ? "bg-primary/15 text-primary border border-primary/30"
                : "border border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            Все предметы
          </button>
          {topics.map(([id, name]) => (
            <button
              key={id}
              onClick={() => setTopicFilter(topicFilter === id ? "" : id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                topicFilter === id
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "border border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {attempts.length === 0 ? "Нет завершённых тестов" : "Ничего не найдено — попробуйте изменить фильтры"}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map(([group, items]) => (
            <section key={group}>
              {/* Time group header */}
              <div className="flex items-center gap-3 mb-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group}</p>
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>

              <div className="flex flex-col gap-2.5">
                {items.map(a => {
                  const p = pct(a.score, a.max_score);
                  const { bar, text } = scoreColor(p);
                  return (
                    <div key={a.id} className="border border-border rounded-2xl bg-card overflow-hidden hover:border-primary/50 transition-colors">
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex-1 min-w-0">
                            {a.topic_name && (
                              <span className="inline-block text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full mb-1.5">
                                {a.topic_name}
                              </span>
                            )}
                            <p className="font-medium text-sm leading-snug truncate">{a.test_title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{formatDate(a.finished_at ?? null)}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-lg font-bold leading-none ${text}`}>{p}%</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{a.score ?? 0}/{a.max_score ?? 0} б.</p>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="h-1.5 bg-muted rounded-full mb-3">
                          <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${p}%` }} />
                        </div>

                        <button
                          onClick={() => router.push(`/student/results/${a.id}`)}
                          className="text-xs text-primary hover:text-primary/80 transition-colors font-medium"
                        >
                          Разобрать ошибки →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
