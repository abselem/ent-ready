"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { LockKeyhole } from "lucide-react";
import { api } from "@/lib/api";
import { AttemptResult, type AttemptResultData } from "@/components/test/attempt-result";
import { PageHeader } from "@/components/ui/page-header";
import { AsyncState } from "@/components/ui/async-state";

interface NotAvailable { error?: string; deadline?: string | null }

export default function AttemptReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  const review = useQuery<AttemptResultData>({
    queryKey: ["attempt-review", attemptId],
    queryFn: async () => (await api.get(`/attempts/${attemptId}/review`)).data,
    retry: false,
  });
  const requestError = review.error as { response?: { status?: number; data?: NotAvailable } } | null;
  const status = requestError?.response?.status;
  const locked = status === 403;
  const deadlineValue = requestError?.response?.data?.deadline;
  const deadline = deadlineValue && Number.isFinite(Date.parse(deadlineValue))
    ? new Date(deadlineValue).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <div className="page-shell page-narrow">
      <PageHeader title="Результат теста" eyebrow="Моя подготовка" description="Баллы и доступный разбор ваших ответов." />
      {review.isPending && <AsyncState kind="loading" title="Загружаем результат…" />}
      {locked && (
        <section aria-labelledby="locked-review-title" className="surface p-5 md:p-6">
          <div className="flex items-start gap-3">
            <LockKeyhole aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
            <div>
              <h2 id="locked-review-title" className="font-semibold">Разбор пока недоступен</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{deadline ? `Разбор откроется после ${deadline} или когда все участники группы сдадут тест.` : "Разбор откроется, когда все участники группы сдадут тест."}</p>
            </div>
          </div>
        </section>
      )}
      {review.isError && !locked && (
        <AsyncState kind="error" title={status === 404 ? "Результат недоступен" : "Не удалось загрузить результат"} description={status === 404 ? "Попытка не найдена или у вас нет доступа к ней." : "Проверьте соединение и повторите загрузку."} onRetry={() => void review.refetch()} />
      )}
      {review.data && !review.isError && <AttemptResult data={review.data} />}
      {!review.data && <Link href="/student/results" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"><span aria-hidden="true">←</span>К результатам</Link>}
    </div>
  );
}
