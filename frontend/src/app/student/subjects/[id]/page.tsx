"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/api";

interface Topic { id: number; name: string }
interface Subtopic { id: number; name: string; topic_id: number }
interface TestWithAuthor {
  id: number;
  title: string;
  description: string;
  max_attempts: number;
  time_limit: number | null;
  author_name: string;
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

export default function SubjectPage() {
  const router = useRouter();
  const params = useParams();
  const topicId = Number(params.id);

  const [subtopicFilter, setSubtopicFilter] = useState<number | null>(null);
  const [loadingRandom, setLoadingRandom] = useState(false);
  const [randomError, setRandomError] = useState("");

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data,
  });

  const topic = topics.find((t) => t.id === topicId);
  const cfg = subjectCfg(topic?.name ?? "");

  const { data: subtopics = [] } = useQuery<Subtopic[]>({
    queryKey: ["subtopics", topicId],
    queryFn: async () => (await api.get(`/topics/${topicId}/subtopics`)).data,
    enabled: !!topicId,
  });

  const { data: tests = [], isLoading: testsLoading } = useQuery<TestWithAuthor[]>({
    queryKey: ["topic-tests", topicId],
    queryFn: async () => (await api.get(`/topics/${topicId}/tests`)).data,
    enabled: !!topicId,
  });

  async function handleRandomTest() {
    setLoadingRandom(true);
    setRandomError("");
    try {
      const { data } = await api.post(`/topics/${topicId}/random-test`);
      router.push(`/student/tests/${data.test_id}`);
    } catch {
      setRandomError("Нет доступных вопросов по этому предмету");
    } finally {
      setLoadingRandom(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.back()}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-lg font-bold text-white shrink-0"
          style={{ backgroundColor: cfg.color }}
        >
          {cfg.symbol}
        </div>
        <h1 className="text-xl font-bold">{topic?.name ?? "..."}</h1>
      </div>

      {/* Subtopic filter chips */}
      {subtopics.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <button
            onClick={() => setSubtopicFilter(null)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              !subtopicFilter
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card hover:bg-muted"
            }`}
          >
            Все
          </button>
          {subtopics.map((s) => (
            <button
              key={s.id}
              onClick={() => setSubtopicFilter(s.id === subtopicFilter ? null : s.id)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                subtopicFilter === s.id
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card hover:bg-muted"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Random test card */}
      <button
        onClick={handleRandomTest}
        disabled={loadingRandom}
        className="w-full mb-4 p-4 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 active:scale-[0.98] transition-all text-left flex items-center gap-3 disabled:opacity-60"
      >
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center text-lg shrink-0">
          🤖
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">Случайный тест</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            20 вопросов · равномерно: лёгкие, средние, сложные
          </p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium shrink-0">
          {loadingRandom ? "..." : "AI"}
        </span>
      </button>
      {randomError && <p className="text-sm text-destructive mb-3">{randomError}</p>}

      {/* Tests list */}
      {testsLoading ? (
        <p className="text-center py-8 text-muted-foreground text-sm">Загрузка...</p>
      ) : tests.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground text-sm">
          Нет опубликованных тестов по этому предмету
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {tests.map((test) => (
            <button
              key={test.id}
              onClick={() => router.push(`/student/tests/${test.id}`)}
              className="text-left w-full"
            >
              <div className="border border-border rounded-2xl p-4 bg-card hover:border-primary transition-colors active:scale-[0.99]">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm leading-snug">{test.title}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0 whitespace-nowrap">
                    {test.max_attempts} попыт.
                  </span>
                </div>
                {test.description && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{test.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    {test.author_name}
                  </span>
                  {test.time_limit && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                      </svg>
                      {test.time_limit} мин
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
