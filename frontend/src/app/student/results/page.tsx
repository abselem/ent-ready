"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Attempt {
  id: number;
  test_id: number;
  test_title: string;
  score: number | null;
  max_score: number | null;
  finished_at: string | null;
  topic_id: number | null;
  topic_name: string | null;
}

export default function StudentResultsPage() {
  const router = useRouter();
  const [filterTopic, setFilterTopic] = useState<number | "">("");

  const { data: attempts = [], isLoading } = useQuery<Attempt[]>({
    queryKey: ["student-attempts"],
    queryFn: async () => (await api.get("/attempts/my")).data,
  });

  const topics = Array.from(
    new Map(
      attempts
        .filter((a) => a.topic_id != null)
        .map((a) => [a.topic_id!, a.topic_name!])
    ).entries()
  ).sort(([, a], [, b]) => a.localeCompare(b, "ru"));

  const displayed = filterTopic
    ? attempts.filter((a) => a.topic_id === filterTopic)
    : attempts;

  function formatDate(ts: string | null) {
    if (!ts) return "";
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function pct(score: number | null, max: number | null) {
    if (!max) return 0;
    return Math.round(((score ?? 0) / max) * 100);
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Мои результаты</h1>

      {attempts.length > 0 && topics.length > 0 && (
        <div className="mb-4">
          <select
            value={filterTopic}
            onChange={(e) => setFilterTopic(e.target.value ? Number(e.target.value) : "")}
            className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary w-full"
          >
            <option value="">Все предметы</option>
            <optgroup label="ЕНТ">
              {topics.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </optgroup>
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Нет завершённых тестов
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {displayed.map((a) => {
            const p = pct(a.score, a.max_score);
            return (
              <Card key={a.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {a.topic_name && (
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-xs font-semibold text-primary uppercase tracking-wide">ЕНТ</span>
                          <span className="text-xs text-muted-foreground">{a.topic_name}</span>
                        </div>
                      )}
                      <CardTitle className="text-base">{a.test_title}</CardTitle>
                    </div>
                    <span
                      className={`text-sm font-semibold shrink-0 ${
                        p >= 80 ? "text-green-600" : p >= 50 ? "text-yellow-600" : "text-destructive"
                      }`}
                    >
                      {a.score ?? 0}/{a.max_score ?? 0}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-1.5 bg-muted rounded-full mb-2">
                    <div
                      className={`h-full rounded-full ${
                        p >= 80 ? "bg-green-500" : p >= 50 ? "bg-yellow-500" : "bg-destructive"
                      }`}
                      style={{ width: `${p}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-muted-foreground">{formatDate(a.finished_at ?? null)}</p>
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2"
                      onClick={() => router.push(`/student/results/${a.id}`)}>
                      Разобрать ошибки →
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
