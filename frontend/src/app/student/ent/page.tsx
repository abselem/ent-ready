"use client";

import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";

interface Topic { id: number; name: string }
interface ENTAttempt {
  id: number;
  started_at: string;
  finished_at: string | null;
  subject3_name: string;
  subject4_name: string;
  total_score: number;
  total_max: number;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Дата не указана" : date.toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function ENTPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const hasSubjects = !!(user?.profile_subject1 && user?.profile_subject2);
  const topicsQuery = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data ?? [],
  });
  const historyQuery = useQuery<ENTAttempt[]>({
    queryKey: ["ent-attempts"],
    queryFn: async () => (await api.get("/ent/attempts/my")).data ?? [],
  });
  const startQuiz = useMutation({
    mutationFn: () => api.post("/ent/start"),
    onSuccess: (response) => router.push(`/student/ent/${response.data.attempt.id}`),
  });
  const subjectName = (id: number | null | undefined, fallback: string) =>
    topicsQuery.data?.find((topic) => topic.id === id)?.name ?? fallback;
  const composition = [
    { name: "Математическая грамотность", detail: "Обязательный предмет" },
    { name: "История Казахстана", detail: "Обязательный предмет" },
    { name: "Грамотность чтения", detail: "Обязательный предмет" },
    { name: subjectName(user?.profile_subject1, "Первый профильный предмет"), detail: user?.profile_subject1 ? "Выбран в профиле" : "Выберите в профиле" },
    { name: subjectName(user?.profile_subject2, "Второй профильный предмет"), detail: user?.profile_subject2 ? "Выбран в профиле" : "Выберите в профиле" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      <header className="space-y-2">
        <p className="text-sm font-medium text-primary">Подготовка к экзамену</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Пробный ЕНТ</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">Практика по обязательным и выбранным профильным предметам. Результаты попыток сохраняются в истории.</p>
      </header>

      <section aria-labelledby="composition-title" className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border p-5 md:p-6"><h2 id="composition-title" className="text-xl font-semibold">Состав пробного теста</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Набор вопросов формируется из доступного банка. Фактическое количество и максимальный балл зависят от выбранных вопросов.</p></div>
        <ol className="divide-y divide-border">
          {composition.map((subject, index) => (
            <li key={index} className="flex items-center gap-4 px-5 py-4 md:px-6">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary">{index + 1}</span>
              <div className="min-w-0"><p className="break-words text-sm font-medium">{subject.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{subject.detail}</p></div>
            </li>
          ))}
        </ol>
        <div className="space-y-4 border-t border-border p-5 md:p-6">
          {topicsQuery.isPending && <p role="status" className="text-sm text-muted-foreground">Загружаем названия профильных предметов…</p>}
          {topicsQuery.isError && <div role="alert" className="text-sm"><p className="text-destructive">Не удалось загрузить названия предметов. Ваш выбор в профиле сохранён.</p><Button variant="ghost" onClick={() => void topicsQuery.refetch()}>Повторить загрузку</Button></div>}
          {!hasSubjects ? (
            <div className="rounded-xl border border-border bg-muted/40 p-4"><p className="text-sm font-medium">Сначала выберите два профильных предмета</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Они определяют состав вашей тренировки.</p><Link href="/student/profile" className="mt-3 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Выбрать предметы в профиле →</Link></div>
          ) : <Link href="/student/profile" className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Изменить профильные предметы</Link>}
          {startQuiz.isError && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">Не удалось начать пробный тест. Проверьте соединение и попробуйте ещё раз.</p>}
          <Button className="min-h-11 w-full sm:w-auto" disabled={!hasSubjects || startQuiz.isPending} loading={startQuiz.isPending} onClick={() => startQuiz.mutate()}>{startQuiz.isPending ? "Создаём попытку…" : "Начать пробный ЕНТ"}</Button>
        </div>
      </section>

      <section aria-labelledby="history-title" className="space-y-4">
        <div><h2 id="history-title" className="text-xl font-semibold">История попыток</h2><p className="mt-1 text-sm text-muted-foreground">Вернитесь к результатам или продолжите незавершённую попытку.</p></div>
        {historyQuery.isPending ? (
          <p role="status" className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">Загружаем историю…</p>
        ) : historyQuery.isError ? (
          <div role="alert" className="rounded-2xl border border-destructive/30 bg-card p-6"><p className="mb-3 text-sm text-destructive">Не удалось загрузить историю попыток.</p><Button variant="outline" onClick={() => void historyQuery.refetch()}>Повторить загрузку</Button></div>
        ) : (historyQuery.data ?? []).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-6"><p className="font-medium">Пока нет попыток</p><p className="mt-1 text-sm text-muted-foreground">После первой тренировки здесь появится её результат.</p></div>
        ) : (
          <div className="space-y-3">
            {historyQuery.data?.map((attempt) => {
              const finished = !!attempt.finished_at;
              const percentage = attempt.total_max > 0 ? Math.round(attempt.total_score / attempt.total_max * 100) : null;
              return (
                <article key={attempt.id} className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0"><h3 className="break-words text-base font-medium">{attempt.subject3_name || "Первый профильный предмет"} · {attempt.subject4_name || "Второй профильный предмет"}</h3><p className="mt-1 text-xs text-muted-foreground">Начало: <time dateTime={attempt.started_at}>{formatDate(attempt.started_at)}</time></p></div>
                    <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{finished ? "Завершён" : "В процессе"}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
                    {finished ? <div><p className="font-semibold tabular-nums">{attempt.total_score} / {attempt.total_max} баллов</p>{percentage !== null && <p className="mt-1 text-xs text-muted-foreground">{percentage}% от максимального балла</p>}</div> : <p className="text-sm text-muted-foreground">Попытка ещё не завершена</p>}
                    <Link href={finished ? `/student/ent/${attempt.id}/result` : `/student/ent/${attempt.id}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">{finished ? "Посмотреть результат" : "Продолжить попытку"}<span aria-hidden="true" className="ml-3">→</span></Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
