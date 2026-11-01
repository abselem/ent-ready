"use client";

import { use, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MathText } from "@/components/math-text";
import { AsyncState } from "@/components/ui/async-state";
import { ENTAnswerQueue } from "../answer-queue";

interface ENTOption { id: number; text: string; order_num: number }
interface ENTQuestion {
  id: number; text: string; is_multi: boolean; order_num: number;
  options: ENTOption[];
}
interface ENTSection {
  slot: number; topic_id: number; topic_name: string;
  max_score: number; questions: ENTQuestion[];
}
interface ENTAttempt {
  id: number; user_id: number; finished_at: string | null;
  subject3_id: number; subject4_id: number;
}
interface ENTData {
  attempt: ENTAttempt;
  sections: ENTSection[];
  answers: Record<number, number[]>;
}

export default function ENTQuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const query = useQuery<ENTData>({
    queryKey: ["ent-attempt", id],
    queryFn: async () => (await api.get(`/ent/attempts/${id}`)).data,
    retry: false,
  });
  useEffect(() => {
    if (query.data?.attempt.finished_at) router.replace(`/student/ent/${id}/result`);
  }, [query.data?.attempt.finished_at, id, router]);
  if (query.isPending) return <div className="page-shell"><AsyncState kind="loading" title="Загружаем тест ЕНТ" /></div>;
  if (query.isError || !query.data) return <div className="page-shell"><AsyncState kind="error" title="Не удалось открыть тест ЕНТ" description="Проверьте соединение и доступ к попытке." onRetry={() => void query.refetch()} /></div>;
  if (query.data.attempt.finished_at) return <div className="page-shell"><AsyncState kind="loading" title="Открываем результат" /></div>;
  return <ENTQuizSession key={id} id={id} data={query.data} />;
}

function ENTQuizSession({ id, data }: { id: string; data: ENTData }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [activeSlot, setActiveSlot] = useState(data.sections[0]?.slot ?? 1);
  const [localAnswers, setLocalAnswers] = useState<Record<number, number[]>>(data.answers ?? {});
  const answers = useRef(localAnswers);
  const [statuses, setStatuses] = useState<Record<number, "saving" | "saved" | "error">>({});
  const queue = useRef<ENTAnswerQueue | null>(null);
  const finishing = useRef(false);
  const [finishError, setFinishError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const writes = new ENTAnswerQueue(
      (questionId, optionIds) => api.post(`/ent/attempts/${id}/answer`, { question_id: questionId, option_ids: optionIds }, { timeout: 10000 }),
      (questionId, status) => setStatuses(previous => ({ ...previous, [questionId]: status })),
    );
    queue.current = writes;
    return () => { writes.dispose(); };
  }, [id]);

  const hasPending = Object.values(statuses).includes("saving");
  const hasErrors = Object.values(statuses).includes("error");
  useEffect(() => {
    if (!hasPending && !hasErrors) return;
    document.body.dataset.unsavedEnt = "true";
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => {
      delete document.body.dataset.unsavedEnt;
      window.removeEventListener("beforeunload", warn);
    };
  }, [hasPending, hasErrors]);

  const finish = useMutation({
    mutationFn: async () => {
      if (!queue.current || !(await queue.current.flush())) throw new Error("unsaved answers");
      // If the response is lost, the server may already have closed the attempt.
      // Keep choices frozen and let the user retry the idempotent finish request.
      setSubmitted(true);
      return api.post(`/ent/attempts/${id}/finish`, undefined, { timeout: 15000 });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ent-attempts"] });
      router.push(`/student/ent/${id}/result`);
    },
    onError: () => {
      finishing.current = false;
      setFinishError("Не удалось завершить тест. Проверьте сохранение ответов и повторите попытку.");
    },
  });

  function choose(qid: number, optionIds: number[]) {
    if (finishing.current || submitted) return;
    const next = { ...answers.current, [qid]: optionIds };
    answers.current = next;
    setLocalAnswers(next);
    setFinishError("");
    queue.current?.choose(qid, optionIds);
  }
  function handleSingleSelect(qid: number, optId: number) { choose(qid, [optId]); }
  function handleMultiToggle(qid: number, optId: number) {
    const current = answers.current[qid] ?? [];
    choose(qid, current.includes(optId) ? current.filter(value => value !== optId) : [...current, optId]);
  }
  function finishTest() {
    if (finishing.current) return;
    finishing.current = true;
    setFinishError("");
    finish.mutate();
  }

  const sections = data.sections ?? [];

  // Count answered per slot
  function answeredCount(section: ENTSection) {
    return section.questions.filter((q) => (localAnswers[q.id]?.length ?? 0) > 0).length;
  }
  const totalAnswered = sections.reduce((sum, s) => sum + answeredCount(s), 0);
  const totalQuestions = sections.reduce((sum, s) => sum + s.questions.length, 0);

  const activeSection = sections.find((s) => s.slot === activeSlot) ?? sections[0];

  return (
    <div className="flex flex-col h-full">
      {/* Section tabs */}
      <div className="border-b border-border bg-card sticky top-0 z-10">
        <div className="flex overflow-x-auto scrollbar-none">
          {sections.map((s) => {
            const answered = answeredCount(s);
            const total = s.questions.length;
            const done = answered === total && total > 0;
            return (
              <button key={s.slot} onClick={() => setActiveSlot(s.slot)}
                className={`flex-none px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeSlot === s.slot
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}>
                <span className={done ? "text-green-600" : ""}>{s.topic_name}</span>
                <span className={`ml-1.5 text-xs ${done ? "text-green-600" : "text-muted-foreground"}`}>
                  {answered}/{total}
                </span>
              </button>
            );
          })}
        </div>
        <div className="px-4 py-1.5 flex flex-wrap gap-3 items-center justify-between text-xs text-muted-foreground border-t border-border">
          <span>Отвечено: <b className="text-foreground">{totalAnswered}/{totalQuestions}</b></span>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            loading={finish.isPending}
            disabled={hasPending || hasErrors || totalQuestions === 0} onClick={finishTest}>
            Завершить тест
          </Button>
        </div>
      </div>

      {(hasPending || hasErrors || finishError) && <div className="border-b border-border px-4 py-3 text-sm" role={hasErrors || finishError ? "alert" : "status"}>
        {finishError || (hasErrors ? "Есть несохранённые ответы. Повторите отправку у соответствующего вопроса." : "Сохраняем ответы… Дождитесь подтверждения перед завершением.")}
      </div>}
      {totalQuestions === 0 && <div className="page-shell"><AsyncState kind="empty" title="В этой попытке нет вопросов" description="Вернитесь к подготовке и создайте новую попытку." /></div>}
      {/* Questions */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {activeSection && (
          <div className="max-w-2xl mx-auto flex flex-col gap-4">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-semibold">{activeSection.topic_name}</h2>
              <span className="text-xs text-muted-foreground">макс. {activeSection.max_score} б.</span>
            </div>

            {activeSection.questions.map((q, qi) => {
              const selected = localAnswers[q.id] ?? [];
              return (
                <Card key={q.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-2 mb-3">
                      <span className="text-xs font-semibold text-muted-foreground shrink-0 mt-0.5">{qi + 1}.</span>
                      <div className="flex-1">
                        <p id={`ent-question-${q.id}`} className="test-question text-sm font-medium leading-snug"><MathText text={q.text} /></p>
                        {q.is_multi && (
                          <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            Несколько ответов
                          </span>
                        )}
                      </div>
                    </div>

                    <fieldset disabled={finish.isPending || submitted} aria-labelledby={`ent-question-${q.id}`} className="flex min-w-0 flex-col gap-2 ml-4">
                      <legend className="sr-only">{q.is_multi ? "Выберите несколько ответов" : "Выберите один ответ"}</legend>
                      {q.options.map(opt => <label key={opt.id} className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-control-border p-3">
                        <input type={q.is_multi ? "checkbox" : "radio"} name={`ent-question-${q.id}`} checked={selected.includes(opt.id)}
                          onChange={() => q.is_multi ? handleMultiToggle(q.id, opt.id) : handleSingleSelect(q.id, opt.id)} className="mt-1 size-4 shrink-0 accent-primary" />
                        <span className="min-w-0 break-words text-sm leading-relaxed"><MathText text={opt.text} /></span>
                      </label>)}
                    </fieldset>
                    <div className="mt-3 text-sm" aria-live="polite">
                      {statuses[q.id] === "saving" ? <span className="text-muted-foreground">Сохраняем ответ…</span>
                        : statuses[q.id] === "error" ? <div className="flex flex-wrap items-center gap-2 text-destructive"><span>Ответ не сохранён</span><Button size="sm" variant="outline" disabled={finish.isPending || submitted} onClick={() => queue.current?.choose(q.id, answers.current[q.id] ?? [])}>Повторить отправку</Button></div>
                        : statuses[q.id] === "saved" || selected.length > 0 ? <span className="text-success">Ответ сохранён</span> : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Next section button */}
            {activeSlot < sections.length && (
              <Button variant="outline" className="mt-2"
                onClick={() => setActiveSlot(activeSlot + 1)}>
                Следующий раздел →
              </Button>
            )}
            {activeSlot === sections.length && (
              <Button className="mt-2" loading={finish.isPending} disabled={hasPending || hasErrors || totalQuestions === 0} onClick={finishTest}>
                Завершить тест ЕНТ
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
