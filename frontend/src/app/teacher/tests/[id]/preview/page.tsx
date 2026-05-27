"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface AnswerOption {
  id: number;
  text: string;
  is_correct: boolean;
  order_num: number;
}

interface Question {
  id: number;
  text: string;
  order_num: number;
  points: number;
  options: AnswerOption[];
}

interface TestFull {
  id: number;
  title: string;
  description: string | null;
  is_published: boolean;
  is_public: boolean;
  max_attempts: number;
  time_limit: number | null;
}

export default function TestPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data, isLoading } = useQuery<TestFull & { questions: Question[] }>({
    queryKey: ["test-full", id],
    queryFn: async () => {
      const { data } = await api.get(`/tests/${id}`);
      return { ...data.test, questions: data.questions ?? [] };
    },
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Загрузка...</div>;
  }
  if (!data) return null;

  const test = data;
  const questions = data.questions;
  const totalPoints = questions.reduce((s, q) => s + q.points, 0);

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto">
      {/* Шапка */}
      <div className="flex items-center gap-3 mb-1">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>←</Button>
        <h1 className="text-2xl font-bold">{test.title}</h1>
      </div>

      <div className="flex flex-wrap gap-2 mb-2 ml-10">
        <span className={`text-xs px-2 py-0.5 rounded-full ${test.is_public ? "bg-blue-100 text-blue-700" : "bg-muted text-muted-foreground"}`}>
          {test.is_public ? "Публичный" : "Приватный"}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${test.is_published ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
          {test.is_published ? "Опубликован" : "Черновик"}
        </span>
      </div>

      <p className="text-sm text-muted-foreground mb-6 ml-10">
        {questions.length} вопр. · {totalPoints} б.
        {test.time_limit ? ` · ${test.time_limit} мин` : ""}
        {" · "}Попыток: {test.max_attempts}
      </p>

      {test.description && (
        <p className="text-sm text-muted-foreground mb-6 ml-10">{test.description}</p>
      )}

      {/* Разделитель с подсказкой */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">Вид студента</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {questions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Вопросов пока нет</div>
      ) : (
        <div className="flex flex-col gap-4">
          {questions.map((q, i) => (
            <Card key={q.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-medium leading-snug">
                    {i + 1}. {q.text}
                  </CardTitle>
                  <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{q.points} б.</span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {q.options.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 border-border text-sm select-none"
                  >
                    <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 shrink-0" />
                    <span>{opt.text}</span>
                  </div>
                ))}
                {q.options.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">Нет вариантов ответа</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Нижняя панель с правильными ответами — только для учителя */}
      {questions.length > 0 && (
        <>
          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">Правильные ответы</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex flex-col gap-2">
            {questions.map((q, i) => {
              const correct = q.options.filter((o) => o.is_correct);
              return (
                <div key={q.id} className="flex gap-3 text-sm">
                  <span className="text-muted-foreground shrink-0 w-6 text-right">{i + 1}.</span>
                  <div>
                    {correct.length > 0 ? (
                      correct.map((o) => (
                        <span key={o.id} className="inline-block bg-green-100 text-green-800 rounded px-1.5 py-0.5 mr-1 text-xs font-medium">
                          {o.text}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground italic text-xs">не задан</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
