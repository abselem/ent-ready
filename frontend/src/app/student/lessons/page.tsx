"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface Lesson {
  id: number;
  title: string;
  description: string;
  scheduled_at: string | null;
  duration_min: number;
  group_id: number | null;
  group_name: string;
  group_category: string;
  section_title: string | null;
  visibility: string;
  view_count: number;
  topic_id: number | null;
  topic_name: string;
  subtopic_id: number | null;
  subtopic_name: string;
}

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

export default function StudentLessonsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: lessons = [], isLoading } = useQuery<Lesson[]>({
    queryKey: ["student-lessons-available"],
    queryFn: async () => (await api.get("/lessons/available")).data,
  });

  const filtered = lessons.filter(l =>
    l.title.toLowerCase().includes(search.toLowerCase()) ||
    l.topic_name.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filtered.reduce((acc: Record<string, Lesson[]>, l) => {
    const key = l.topic_name || "Без предмета";
    if (!acc[key]) acc[key] = [];
    acc[key].push(l);
    return acc;
  }, {});

  const topicOrder = Object.keys(subjectConfig);
  const sortedTopics = Object.keys(grouped).sort((a, b) => {
    const aIdx = topicOrder.indexOf(a);
    const bIdx = topicOrder.indexOf(b);
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "2-digit", month: "long", year: "numeric",
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-5">Уроки</h1>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск по названию или предмету..."
          className="w-full border border-border rounded-xl pl-9 pr-4 py-2.5 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {lessons.length === 0 ? "Нет доступных уроков" : "Уроки не найдены"}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sortedTopics.map((topicName) => {
            const cfg = subjectCfg(topicName);
            return (
              <div key={topicName}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0"
                    style={{ backgroundColor: cfg.color }}
                  >
                    {cfg.symbol}
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">{topicName}</h2>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                    {grouped[topicName].length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {grouped[topicName].map((lesson, idx) => (
                    <button
                      key={lesson.id}
                      onClick={() => router.push(`/student/lessons/${lesson.id}`)}
                      className="text-left w-full border border-border rounded-xl p-3 bg-card hover:border-primary transition-colors flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug truncate">{lesson.title}</p>
                        {lesson.subtopic_name && (
                          <p className="text-xs text-muted-foreground truncate">{lesson.subtopic_name}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {lesson.group_name || "Публичный"}
                          {lesson.scheduled_at && ` · ${formatDate(lesson.scheduled_at)}`}
                          {lesson.duration_min > 0 && ` · ${lesson.duration_min} мин`}
                        </p>
                      </div>
                      <svg className="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
