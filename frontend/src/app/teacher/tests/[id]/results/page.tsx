"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ResultRow {
  user_id: number;
  first_name: string;
  last_name: string;
  attempt_id: number;
  score: number | null;
  max_score: number | null;
  finished_at: string | null;
}

export default function TestResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data, isLoading } = useQuery<{ test: { title: string }; results: ResultRow[] }>({
    queryKey: ["test-results", id],
    queryFn: async () => (await api.get(`/tests/${id}/results`)).data,
  });

  function pct(row: ResultRow) {
    if (!row.max_score) return 0;
    return Math.round(((row.score ?? 0) / row.max_score) * 100);
  }

  function formatDate(ts: string | null) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>←</Button>
        <h1 className="text-2xl font-bold">{data?.test.title ?? "Результаты"}</h1>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
      ) : !data?.results.length ? (
        <div className="text-center py-12 text-muted-foreground">Никто ещё не прошёл тест</div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.results.map((row, i) => {
            const p = pct(row);
            return (
              <Card key={row.attempt_id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground text-sm w-5 text-center">{i + 1}</span>
                      <div>
                        <CardTitle className="text-sm font-medium">
                          {row.first_name} {row.last_name}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(row.finished_at ?? null)}</p>
                      </div>
                    </div>
                    <span className={`text-base font-bold ${p >= 80 ? "text-green-600" : p >= 50 ? "text-yellow-600" : "text-destructive"}`}>
                      {row.score ?? 0}/{row.max_score ?? 0}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="h-1.5 bg-muted rounded-full">
                    <div
                      className={`h-full rounded-full transition-all ${p >= 80 ? "bg-green-500" : p >= 50 ? "bg-yellow-500" : "bg-destructive"}`}
                      style={{ width: `${p}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 text-right">{p}%</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
