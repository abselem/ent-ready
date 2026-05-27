"use client";

import { use, useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface AnswerOption { id: number; text: string }
interface Question { id: number; text: string; order_num: number; options: AnswerOption[] }
interface AttemptStarted { attempt_id: number; questions: Question[] }
interface QuestionResult {
  id: number; text: string; is_correct: boolean;
  options: { id: number; text: string; is_correct: boolean; chosen: boolean }[];
}
interface FinishResult {
  score: number;
  max_score: number;
  can_see_answers: boolean;
  deadline?: string | null;
  questions?: QuestionResult[];
}

export default function TakeTestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [result, setResult] = useState<FinishResult | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: test } = useQuery<{ title: string; max_attempts: number; time_limit: number | null }>({
    queryKey: ["test-info", id],
    queryFn: async () => (await api.get(`/tests/${id}`)).data.test,
  });

  // Таймер обратного отсчёта
  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      finishAttempt.mutate();
      return;
    }
    timerRef.current = setInterval(() => setSecondsLeft((s) => (s ?? 1) - 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [secondsLeft !== null ? Math.floor(secondsLeft / 60) : null]); // re-run only on minute boundaries

  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((s) => (s ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  const startAttempt = useMutation({
    mutationFn: async () => (await api.post<AttemptStarted>(`/tests/${id}/attempts`)).data,
    onSuccess: (data) => {
      setAttemptId(data.attempt_id);
      setQuestions(data.questions);
      setSelected({});
      setCurrentQ(0);
      if (test?.time_limit && test.time_limit > 0) {
        setSecondsLeft(test.time_limit * 60);
      }
    },
  });

  const submitAnswer = useMutation({
    mutationFn: ({ questionId, optionId }: { questionId: number; optionId: number }) =>
      api.post(`/attempts/${attemptId}/answer`, { question_id: questionId, option_id: optionId }),
  });

  const finishAttempt = useMutation({
    mutationFn: async () => (await api.post<FinishResult>(`/attempts/${attemptId}/finish`)).data,
    onSuccess: (data) => {
      setSecondsLeft(null);
      if (timerRef.current) clearInterval(timerRef.current);
      setResult(data);
    },
  });

  function handleSelect(questionId: number, optionId: number) {
    setSelected((prev) => ({ ...prev, [questionId]: optionId }));
    submitAnswer.mutate({ questionId, optionId });
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  // Результаты
  if (result) {
    const pct = result.max_score > 0 ? Math.round((result.score / result.max_score) * 100) : 0;
    const deadlineLabel = result.deadline
      ? new Date(result.deadline).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : null;
    return (
      <div className="p-4 md:p-6 max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="text-5xl font-bold mb-2">{result.score}/{result.max_score}</div>
          <div className="text-muted-foreground">{pct}% правильных ответов</div>
        </div>

        {!result.can_see_answers ? (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-center mb-6">
            <p className="text-sm font-medium mb-1">Разбор ошибок пока недоступен</p>
            <p className="text-xs text-muted-foreground">
              {deadlineLabel
                ? `Результаты откроются после ${deadlineLabel} или когда все участники сдадут тест`
                : "Результаты откроются когда все участники группы сдадут тест"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 mb-6">
            {(result.questions ?? []).map((q) => (
              <Card key={q.id} className={q.is_correct ? "border-green-500" : "border-destructive"}>
                <CardHeader><CardTitle className="text-sm font-medium">{q.text}</CardTitle></CardHeader>
                <CardContent>
                  {q.options.map((opt) => (
                    <div key={opt.id} className={`text-sm px-3 py-1.5 rounded mb-1 ${
                      opt.chosen && opt.is_correct ? "bg-green-100 text-green-800" :
                      opt.chosen && !opt.is_correct ? "bg-red-100 text-red-800" :
                      opt.is_correct ? "bg-green-50 text-green-700" : ""
                    }`}>{opt.text}</div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Button className="w-full" onClick={() => router.push("/student/results")}>К результатам</Button>
      </div>
    );
  }

  // Стартовый экран
  if (!attemptId) {
    return (
      <div className="p-4 md:p-6 max-w-lg mx-auto flex flex-col items-center gap-6 pt-16">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">{test?.title}</h1>
          <div className="flex gap-4 justify-center text-sm text-muted-foreground mt-2">
            <span>Попыток: {test?.max_attempts}</span>
            {test?.time_limit && test.time_limit > 0 && (
              <span>⏱ {test.time_limit} мин</span>
            )}
          </div>
        </div>
        <Button size="lg" className="w-full" loading={startAttempt.isPending} onClick={() => startAttempt.mutate()}>
          Начать тест
        </Button>
        {startAttempt.isError && (
          <p className="text-sm text-destructive">Превышено количество попыток или тест недоступен</p>
        )}
      </div>
    );
  }

  const q = questions[currentQ];
  if (!q) return null;

  const isLowTime = secondsLeft !== null && secondsLeft < 60;

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">
          Вопрос {currentQ + 1} из {questions.length}
        </span>
        {secondsLeft !== null && (
          <span className={`text-sm font-mono font-semibold ${isLowTime ? "text-destructive" : "text-muted-foreground"}`}>
            ⏱ {formatTime(secondsLeft)}
          </span>
        )}
      </div>

      <div className="h-1.5 bg-muted rounded-full mb-6">
        <div className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base font-medium">{q.text}</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {q.options.map((opt) => (
              <button key={opt.id} onClick={() => handleSelect(q.id, opt.id)}
                className={`text-left px-4 py-3 rounded-lg border-2 transition-colors text-sm ${
                  selected[q.id] === opt.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
                }`}>
                {opt.text}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        {currentQ > 0 && (
          <Button variant="outline" onClick={() => setCurrentQ(currentQ - 1)} className="flex-1">Назад</Button>
        )}
        {currentQ < questions.length - 1 ? (
          <Button className="flex-1" disabled={!selected[q.id]} onClick={() => setCurrentQ(currentQ + 1)}>Далее</Button>
        ) : (
          <Button className="flex-1" disabled={Object.keys(selected).length < questions.length}
            loading={finishAttempt.isPending} onClick={() => finishAttempt.mutate()}>
            Завершить тест
          </Button>
        )}
      </div>
    </div>
  );
}
