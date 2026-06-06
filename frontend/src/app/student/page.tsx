"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

interface Topic { id: number; name: string }
interface Test {
  id: number;
  title: string;
  max_attempts: number;
  is_published: boolean;
  time_limit: { Int16: number; Valid: boolean } | null;
}
interface Group { id: number; name: string }

const subjectConfig: Record<string, { symbol: string; color: string }> = {
  "Математика":               { symbol: "∑",  color: "#3b82f6" },
  "Физика":                   { symbol: "⚛",  color: "#8b5cf6" },
  "Химия":                    { symbol: "⚗",  color: "#10b981" },
  "Биология":                 { symbol: "🧬", color: "#059669" },
  "География":                { symbol: "🌍", color: "#0891b2" },
  "Информатика":              { symbol: "⌨",  color: "#6366f1" },
  "Всемирная история":        { symbol: "📜", color: "#f59e0b" },
  "Основы права и экономики": { symbol: "⚖",  color: "#64748b" },
  "Английский язык":          { symbol: "EN", color: "#0369a1" },
  "Французский язык":         { symbol: "FR", color: "#dc2626" },
  "Немецкий язык":            { symbol: "DE", color: "#ca8a04" },
  "Казахская литература":     { symbol: "Қ",  color: "#b45309" },
  "Русская литература":       { symbol: "Р",  color: "#be185d" },
};

function subjectCfg(name: string) {
  return subjectConfig[name] ?? { symbol: name.slice(0, 2).toUpperCase(), color: "#64748b" };
}

export default function StudentHomePage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [search, setSearch] = useState("");

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data,
  });

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["joined-groups-home"],
    queryFn: async () => (await api.get("/groups/joined")).data,
  });

  const { data: groupTests = [] } = useQuery<Test[]>({
    queryKey: ["student-assigned-tests", groups.map((g) => g.id)],
    queryFn: async () => {
      const all = await Promise.all(
        groups.map((g) =>
          api.get(`/groups/${g.id}/tests`).then((r) => (r.data ?? []) as Test[])
        )
      );
      return all.flat().filter((t) => t.is_published);
    },
    enabled: groups.length > 0,
  });

  const filteredTopics = topics.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Привет, {user?.first_name}!</h1>
      </div>

      {/* Assigned tests */}
      {groupTests.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Назначенные мне
          </h2>
          <div className="flex flex-col gap-2">
            {groupTests.map((test) => (
              <button
                key={test.id}
                onClick={() => router.push(`/student/tests/${test.id}`)}
                className="text-left w-full border border-border rounded-xl p-3 bg-card hover:border-primary transition-colors flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
                    <rect x="9" y="3" width="6" height="4" rx="1"/>
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{test.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {test.max_attempts} попыт.
                    {test.time_limit?.Valid && test.time_limit.Int16 > 0 && ` · ${test.time_limit.Int16} мин`}
                  </p>
                </div>
                <svg className="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по предметам..."
          className="w-full border border-border rounded-xl pl-9 pr-4 py-2.5 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Topics grid */}
      {filteredTopics.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground text-sm">Предметы не найдены</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {filteredTopics.map((topic) => {
            const cfg = subjectCfg(topic.name);
            return (
              <button
                key={topic.id}
                onClick={() => router.push(`/student/subjects/${topic.id}`)}
                className="flex flex-col items-center gap-2.5 p-4 rounded-2xl border border-border bg-card hover:border-primary hover:shadow-sm transition-all text-center active:scale-[0.97]"
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-bold text-white"
                  style={{ backgroundColor: cfg.color }}
                >
                  {cfg.symbol}
                </div>
                <span className="text-sm font-medium leading-tight">{topic.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
