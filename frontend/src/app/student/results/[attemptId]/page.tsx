"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface OptionResult {
  id: number;
  text: string;
  is_correct: boolean;
  chosen: boolean;
}
interface QuestionResult {
  id: number;
  text: string;
  points: number;
  is_correct: boolean;
  options: OptionResult[];
}
interface ReviewData {
  score: number | null;
  max_score: number | null;
  questions: QuestionResult[];
}
interface NotAvailable {
  error: string;
  deadline?: string | null;
}

export default function AttemptReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const router = useRouter();

  const { data, isLoading, isError, error } = useQuery<ReviewData>({
    queryKey: ["attempt-review", attemptId],
    queryFn: async () => {
      const res = await api.get(`/attempts/${attemptId}/review`);
      return res.data;
    },
    retry: false,
  });

  const axiosError = error as { response?: { status: number; data: NotAvailable } } | null;
  const notAvailable = axiosError?.response?.status === 403 ? axiosError.response.data : null;

  function formatDate(ts: string | null | undefined) {
    if (!ts) return null;
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>←</Button>
        <h1 className="text-2xl font-bold">Разбор ошибок</h1>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
      )}

      {notAvailable && (
        <div className="rounded-lg border border-border bg-muted/40 p-6 text-center">
          <p className="font-medium mb-2">Разбор пока недоступен</p>
          <p className="text-sm text-muted-foreground">
            {notAvailable.deadline
              ? `Результаты откроются после ${formatDate(notAvailable.deadline)} или когда все участники сдадут тест`
              : "Результаты откроются когда все участники группы сдадут тест"}
          </p>
        </div>
      )}

      {isError && !notAvailable && (
        <div className="text-center py-12 text-destructive text-sm">Не удалось загрузить разбор</div>
      )}

      {data && (
        <>
          <div className="text-center mb-6">
            <div className="text-4xl font-bold">{data.score ?? 0}/{data.max_score ?? 0}</div>
            <div className="text-muted-foreground text-sm mt-1">
              {data.max_score ? Math.round(((data.score ?? 0) / data.max_score) * 100) : 0}% правильных ответов
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {data.questions.map((q, i) => (
              <Card key={q.id} className={`border-2 ${q.is_correct ? "border-green-500" : "border-destructive"}`}>
                <CardHeader>
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground text-sm mt-0.5 shrink-0">{i + 1}.</span>
                    <div className="flex-1">
                      <CardTitle className="text-sm font-medium leading-snug">{q.text}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">{q.points} б.</p>
                    </div>
                    <span className={`text-xs font-semibold shrink-0 ${q.is_correct ? "text-green-600" : "text-destructive"}`}>
                      {q.is_correct ? "✓" : "✗"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-col gap-1">
                    {q.options.map((opt) => (
                      <div key={opt.id} className={`text-sm px-3 py-2 rounded-md ${
                        opt.chosen && opt.is_correct
                          ? "bg-green-100 text-green-800 font-medium"
                          : opt.chosen && !opt.is_correct
                          ? "bg-red-100 text-red-800 font-medium"
                          : opt.is_correct
                          ? "bg-green-50 text-green-700"
                          : "text-muted-foreground"
                      }`}>
                        {opt.text}
                        {opt.chosen && !opt.is_correct && " — ваш ответ"}
                        {opt.is_correct && !opt.chosen && " — правильный ответ"}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
