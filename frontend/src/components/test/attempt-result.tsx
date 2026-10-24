import Link from "next/link";
import { CheckCircle2, CircleX, LockKeyhole, ArrowRight } from "lucide-react";
import { MathText } from "@/components/math-text";
import { scorePercent } from "@/lib/test-attempt-state";

export interface ReviewQuestion {
  id: number; text: string; points?: number; is_correct: boolean;
  options: { id: number; text: string; is_correct: boolean; chosen: boolean }[];
}
export interface AttemptResultData {
  score: number | null; max_score: number | null; can_see_answers?: boolean;
  deadline?: string | null; questions?: ReviewQuestion[]; time_expired?: boolean;
}

export function AttemptResult({ data }: { data: AttemptResultData }) {
  const percent = scorePercent(data.score, data.max_score);
  const deadline = data.deadline && Number.isFinite(Date.parse(data.deadline)) ? new Date(data.deadline).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" }) : null;
  return <div className="space-y-6">
    <section className="surface px-5 py-7 md:px-8">
      <div className="mb-4 flex items-center gap-2 text-sm font-medium text-success"><CheckCircle2 aria-hidden="true" className="size-5" />Тест завершён</div>
      <h2 className="text-4xl font-semibold tracking-tight md:text-5xl">{data.score ?? "—"}<span className="ml-2 text-xl font-normal text-muted-foreground">/ {data.max_score ?? "—"} баллов</span></h2>
      {percent !== null && <p className="mt-3 text-sm text-muted-foreground">{percent}% от максимального балла</p>}
      {data.time_expired && <p className="mt-3 text-sm text-muted-foreground">Время вышло. Учтены только ответы, принятые сервером до завершения. Неподтверждённые ответы могли не войти в результат.</p>}
    </section>
    {data.can_see_answers === false ? <section className="surface flex items-start gap-3 p-5">
      <LockKeyhole aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
      <div><h2 className="font-medium">Разбор пока недоступен</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{deadline ? `Разбор откроется после ${deadline} или когда все участники группы сдадут тест.` : "Разбор откроется, когда все участники группы сдадут тест."}</p></div>
    </section> : data.questions && data.questions.length > 0 ? <section aria-label="Разбор ответов" className="space-y-4">
      <h2 className="text-lg font-semibold">Разбор ответов</h2>
      {data.questions.map((question, index) => <article key={question.id} className="surface p-5 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Вопрос {index + 1}{question.points !== undefined ? ` · ${question.points} б.` : ""}</span>
          <span className={`inline-flex items-center gap-1.5 font-medium ${question.is_correct ? "text-success" : "text-destructive"}`}>{question.is_correct ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <CircleX aria-hidden="true" className="size-4" />}{question.is_correct ? "Верно" : "Неверно"}</span>
        </div>
        <div className="test-question mb-5 font-medium"><MathText text={question.text} /></div>
        <div className="space-y-2">{question.options.map((option) => <div key={option.id} className={`rounded-[10px] px-3 py-3 text-sm ${option.is_correct ? "bg-success-surface text-success" : option.chosen ? "bg-destructive-surface text-destructive" : "bg-muted/40 text-muted-foreground"}`}>
          <MathText text={option.text} />
          {(option.chosen || option.is_correct) && <p className="mt-1 text-xs font-medium">{option.chosen && option.is_correct ? "Ваш верный ответ" : option.chosen ? "Ваш ответ" : "Правильный ответ"}</p>}
        </div>)}</div>
      </article>)}
    </section> : null}
    <Link href="/student/results" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">К результатам<ArrowRight aria-hidden="true" className="size-4" /></Link>
  </div>;
}
