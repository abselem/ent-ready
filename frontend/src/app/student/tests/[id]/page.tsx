"use client";

import { use, useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Clock3, LoaderCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AsyncState } from "@/components/ui/async-state";
import { MathText } from "@/components/math-text";
import { AttemptResult, type AttemptResultData } from "@/components/test/attempt-result";
import { AnswerWriteQueue, remainingSeconds, type AnswerState } from "@/lib/test-attempt-state";

interface Question { id: number; text: string; points: number; options: { id: number; text: string }[] }
interface TestInfo { id: number; title: string; max_attempts: number; time_limit: number | null; deadline: string | null }
interface Started { attempt_id: number; test: { title: string; time_limit: number | null }; questions: Question[] }

export default function TakeTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TestSession key={id} id={id} />;
}

function TestSession({ id }: { id: string }) {
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [writes, setWrites] = useState<Record<number, AnswerState>>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [result, setResult] = useState<AttemptResultData | null>(null);
  const [endAt, setEndAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [finishError, setFinishError] = useState("");
  const queue = useRef<AnswerWriteQueue | null>(null);
  const finishing = useRef(false);
  const expired = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const info = useQuery<{ test: TestInfo }>({ queryKey: ["test-info", id], queryFn: async () => (await api.get(`/tests/${id}`)).data, retry: false, enabled: attemptId === null });
  const test = info.data?.test ?? { id: 0, title: "Тест", max_attempts: 0, time_limit: null, deadline: null };

  const finish = useCallback(async (timedOut = false) => {
    if (!attemptId || finishing.current) return;
    finishing.current = true;
    setBusy(true);
    setFinishError("");
    if (timedOut) { expired.current = true; queue.current?.freeze(); }
    try {
      if (timedOut) {
        // Do not deadlock at expiry. The server owns the actual acceptance cutoff.
        await queue.current?.settleWithin(2500);
      } else if (!(await queue.current?.flush())) {
        setFinishError("Есть несохранённые ответы. Повторите их отправку перед завершением.");
        return;
      }
      const { data } = await api.post<AttemptResultData>(`/attempts/${attemptId}/finish`, undefined, { timeout: 15000 });
      queue.current?.freeze();
      setResult({ ...data, time_expired: timedOut || data.time_expired });
      setEndAt(null);
    } catch {
      setFinishError("Не удалось получить результат. Повторите завершение — повторный запрос не создаст новую попытку.");
    } finally { finishing.current = false; setBusy(false); }
  }, [attemptId]);

  useEffect(() => {
    if (endAt === null || result || !attemptId) return;
    const timer = setInterval(() => {
      const left = remainingSeconds(endAt);
      setSecondsLeft(left);
      if (left === 0 && !expired.current) void finish(true);
    }, 250);
    return () => clearInterval(timer);
  }, [endAt, result, attemptId, finish]);

  useEffect(() => {
    if (!attemptId || result) return;
    document.body.dataset.activeAttempt = "true";
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { delete document.body.dataset.activeAttempt; window.removeEventListener("beforeunload", warn); };
  }, [attemptId, result]);
  useEffect(() => () => queue.current?.dispose(), []);
  useEffect(() => { heading.current?.focus(); }, [currentQ, attemptId, result]);

  const start = useMutation({
    mutationFn: async () => {
      const requestedAt = Date.now();
      const { data } = await api.post<Started>(`/tests/${id}/attempts`, undefined, { timeout: 15000 });
      return { data, requestedAt };
    },
    onSuccess: ({ data, requestedAt }) => {
      queue.current?.dispose();
      queue.current = new AnswerWriteQueue(async (questionId, optionId) => {
        try {
          return await api.post(`/attempts/${data.attempt_id}/answer`, { question_id: questionId, option_id: optionId }, { timeout: 10000 });
        } catch (error) {
          const failure = error as { response?: { status: number; data?: { error?: string } } };
          if (failure.response?.status === 403 && failure.response.data?.error === "attempt time expired") {
            setSecondsLeft(0);
            setEndAt(Date.now());
          }
          throw error;
        }
      },
        (state) => setWrites((old) => ({ ...old, [state.questionId]: state })));
      setQuestions(data.questions); setSelected({}); setWrites({}); setCurrentQ(0); setResult(null); setFinishError("");
      expired.current = false;
      const timeLimit = data.test.time_limit;
      const limitEnd = timeLimit && timeLimit > 0 ? requestedAt + timeLimit * 60000 : Infinity;
      const deadline = test?.deadline ? Date.parse(test.deadline) : Infinity;
      const nextEnd = Math.min(limitEnd, Number.isFinite(deadline) ? deadline : Infinity);
      setEndAt(Number.isFinite(nextEnd) ? nextEnd : null);
      setSecondsLeft(remainingSeconds(Number.isFinite(nextEnd) ? nextEnd : null));
      setAttemptId(data.attempt_id);
    },
  });

  if (!attemptId && info.isPending) return <div className="page-shell page-narrow"><AsyncState kind="loading" title="Загружаем тест" description="Проверяем доступ и условия прохождения." /></div>;
  if (!attemptId && (info.isError || !info.data?.test)) return <div className="page-shell page-narrow"><PageHeader title="Тест недоступен" description="Материал мог быть закрыт или удалён. Повторите запрос или вернитесь к списку." /><AsyncState kind="error" title="Не удалось открыть тест" onRetry={() => void info.refetch()} /><Link className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm text-primary" href="/student"><ArrowLeft aria-hidden="true" className="size-4" />К моим тестам</Link></div>;
  if (result) return <div className="page-shell page-narrow"><PageHeader title="Результат теста" description={test.title} eyebrow="Моя подготовка" /><AttemptResult data={result} /></div>;

  if (!attemptId) return <div className="page-shell page-narrow">
    <Link href="/student" className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft aria-hidden="true" className="size-4" />Мои тесты</Link>
    <PageHeader title={test.title} description="Проверьте условия и начните, когда будете готовы." eyebrow="Перед началом" />
    <section className="surface p-6 md:p-8">
      <h2 className="mb-5 text-lg font-medium">Условия прохождения</h2>
      <dl className="grid gap-5 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Максимум попыток</dt><dd className="mt-1 font-semibold">{test.max_attempts}</dd></div><div><dt className="text-muted-foreground">Лимит времени</dt><dd className="mt-1 font-semibold">{test.time_limit && test.time_limit > 0 ? `${test.time_limit} мин` : "Без ограничения"}</dd></div></dl>
      <p className="mt-6 border-t border-border pt-5 text-sm leading-relaxed text-muted-foreground">Ответы отправляются по мере выбора. Не обновляйте страницу во время прохождения: восстановление обычного теста после перезагрузки пока недоступно.</p>
      <Button size="lg" className="mt-6 w-full sm:w-auto" loading={start.isPending} onClick={() => start.mutate()}>Начать тест<ArrowRight aria-hidden="true" className="size-4" /></Button>
      {start.isError && <p role="alert" className="mt-4 text-sm text-destructive">Не удалось начать тест. Возможно, попытки закончились, истёк срок или изменился доступ. Повторный старт может расходовать попытку, если предыдущий запрос уже был принят.</p>}
    </section>
  </div>;

  const question = questions[currentQ];
  const values = Object.values(writes);
  const failed = values.filter((state) => state.status === "error");
  const pending = values.some((state) => state.status === "saving");
  const state = question ? writes[question.id]?.status : undefined;
  const timedOut = secondsLeft === 0;
  const readOnly = busy || timedOut;
  const allChosen = questions.length > 0 && questions.every((item) => selected[item.id] !== undefined);
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  if (!question) return <div className="page-shell page-narrow"><AsyncState kind="error" title="В тесте нет доступных вопросов" description="Попытка уже создана. Не начинайте новую: вернитесь к списку или сообщите учителю." /></div>;
  return <div className="page-shell page-narrow">
    <p className="mb-2 text-xs font-semibold tracking-[.12em] text-muted-foreground uppercase">Прохождение теста</p>
    <h1 className="mb-6 text-lg font-semibold md:text-xl">{test.title}</h1>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="font-medium">Вопрос {currentQ + 1} <span className="font-normal text-muted-foreground">из {questions.length}</span></p>
      {secondsLeft !== null && <p className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 tabular-nums ${secondsLeft < 60 ? "bg-destructive-surface text-destructive" : "bg-card text-muted-foreground"}`}><Clock3 aria-hidden="true" className="size-4" /><span><span className="mr-2 text-xs">Примерно осталось</span><strong>{formatTime(secondsLeft)}</strong></span></p>}
    </div>
    <div role="progressbar" aria-label="Положение в тесте" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={currentQ + 1} className="mb-6 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} /></div>
    {timedOut && <p role="status" className="mb-4 rounded-xl border border-border bg-accent p-4 text-sm">Время вышло. {busy ? "Получаем результат…" : "Новые ответы больше не отправляются. Завершите попытку, чтобы получить результат."}</p>}
    <section className="surface p-5 md:p-7">
      <fieldset aria-labelledby="question-heading" disabled={readOnly} className="min-w-0"><legend className="sr-only">Выберите один ответ</legend>
        <h2 id="question-heading" ref={heading} tabIndex={-1} className="test-question mb-6 text-lg leading-relaxed font-medium outline-none md:text-xl"><MathText text={question.text} /></h2>
        <div className="space-y-3">{question.options.map((option, index) => <label key={option.id} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-[10px] border px-4 py-3 text-sm transition-colors ${selected[question.id] === option.id ? "border-primary bg-accent" : "border-control-border bg-card hover:bg-muted/50"} ${readOnly ? "cursor-default opacity-70" : ""}`}>
          <input type="radio" name={`question-${question.id}`} value={option.id} checked={selected[question.id] === option.id} onChange={() => { setSelected((old) => ({ ...old, [question.id]: option.id })); setFinishError(""); queue.current?.choose(question.id, option.id); }} className="mt-1 size-4 shrink-0 accent-primary" />
          <span className="min-w-0 flex-1"><span className="mr-2 text-muted-foreground">{String.fromCharCode(65 + index)}.</span><MathText text={option.text} /></span>
        </label>)}</div>
      </fieldset>
      <div aria-live="polite" className="mt-5 min-h-11 text-sm">
        {state === "saving" ? <p className="flex items-center gap-2 text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />Сохраняем ответ…</p> : state === "saved" ? <p className="flex items-center gap-2 text-success"><Check aria-hidden="true" className="size-4" />Ответ сохранён</p> : state === "error" ? <div className="flex flex-wrap items-center gap-3 text-destructive"><p className="flex items-center gap-2"><CircleAlert aria-hidden="true" className="size-4" />Ответ не сохранён.</p>{!timedOut && <Button size="sm" variant="outline" onClick={() => queue.current?.retry(question.id)}>Повторить отправку</Button>}</div> : <p className="text-muted-foreground">Выберите вариант ответа.</p>}
      </div>
    </section>
    {failed.length > 0 && state !== "error" && !timedOut && <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-destructive-surface p-4 text-sm text-destructive"><span>Есть несохранённый ответ.</span><button className="min-h-11 font-medium underline" onClick={() => setCurrentQ(questions.findIndex((item) => item.id === failed[0].questionId))}>Перейти к вопросу</button></div>}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <Button variant="outline" disabled={currentQ === 0 || busy} onClick={() => setCurrentQ((value) => value - 1)}><ArrowLeft aria-hidden="true" className="size-4" />Назад</Button>
      {timedOut ? <Button loading={busy} onClick={() => void finish(true)}>Получить результат</Button> : currentQ < questions.length - 1 ? <Button disabled={state !== "saved" || busy} onClick={() => setCurrentQ((value) => value + 1)}>Далее<ArrowRight aria-hidden="true" className="size-4" /></Button> : <Button loading={busy} disabled={!allChosen || pending || failed.length > 0} onClick={() => void finish()}>Завершить тест</Button>}
    </div>
    {finishError && <p role="alert" className="mt-4 rounded-xl bg-destructive-surface p-4 text-sm text-destructive">{finishError}</p>}
    <p className="mt-6 text-xs leading-relaxed text-muted-foreground">Не обновляйте страницу до завершения. Показание таймера приблизительное; срок приёма ответов определяет сервер.</p>
  </div>;
}
