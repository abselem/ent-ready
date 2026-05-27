"use client";

import { use, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

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
  const qc = useQueryClient();
  const [activeSlot, setActiveSlot] = useState(1);

  const { data, isLoading } = useQuery<ENTData>({
    queryKey: ["ent-attempt", id],
    queryFn: async () => {
      const res = await api.get(`/ent/attempts/${id}`);
      return res.data;
    },
  });

  // Local answers state, synced from server on load
  const [localAnswers, setLocalAnswers] = useState<Record<number, number[]>>({});
  const [initialized, setInitialized] = useState(false);

  if (data && !initialized) {
    setLocalAnswers(data.answers ?? {});
    setInitialized(true);
  }

  const saveAnswer = useMutation({
    mutationFn: ({ questionId, optionIds }: { questionId: number; optionIds: number[] }) =>
      api.post(`/ent/attempts/${id}/answer`, { question_id: questionId, option_ids: optionIds }),
  });

  const finish = useMutation({
    mutationFn: () => api.post(`/ent/attempts/${id}/finish`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ent-attempts"] });
      router.push(`/student/ent/${id}/result`);
    },
  });

  const handleSingleSelect = useCallback((qid: number, optId: number) => {
    const newSel = [optId];
    setLocalAnswers((prev) => ({ ...prev, [qid]: newSel }));
    saveAnswer.mutate({ questionId: qid, optionIds: newSel });
  }, [saveAnswer]);

  const handleMultiToggle = useCallback((qid: number, optId: number) => {
    setLocalAnswers((prev) => {
      const cur = prev[qid] ?? [];
      const next = cur.includes(optId) ? cur.filter((x) => x !== optId) : [...cur, optId];
      saveAnswer.mutate({ questionId: qid, optionIds: next });
      return { ...prev, [qid]: next };
    });
  }, [saveAnswer]);

  if (isLoading || !data) return <div className="p-6 text-muted-foreground">Загрузка...</div>;

  if (data.attempt.finished_at) {
    router.push(`/student/ent/${id}/result`);
    return null;
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
        <div className="px-4 py-1.5 flex items-center justify-between text-xs text-muted-foreground border-t border-border">
          <span>Отвечено: <b className="text-foreground">{totalAnswered}/{totalQuestions}</b></span>
          <Button size="sm" variant="outline" className="h-7 text-xs"
            loading={finish.isPending}
            onClick={() => finish.mutate()}>
            Завершить тест
          </Button>
        </div>
      </div>

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
                        <p className="text-sm font-medium leading-snug">{q.text}</p>
                        {q.is_multi && (
                          <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            Несколько ответов
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 ml-4">
                      {q.options.map((opt) => {
                        const isSelected = selected.includes(opt.id);
                        if (q.is_multi) {
                          return (
                            <label key={opt.id} className="flex items-start gap-2.5 cursor-pointer group">
                              <div
                                onClick={() => handleMultiToggle(q.id, opt.id)}
                                className={`w-5 h-5 mt-0.5 shrink-0 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
                                  isSelected ? "bg-primary border-primary" : "border-border group-hover:border-primary/50"
                                }`}
                              >
                                {isSelected && (
                                  <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                )}
                              </div>
                              <span onClick={() => handleMultiToggle(q.id, opt.id)}
                                className="text-sm leading-snug">{opt.text}</span>
                            </label>
                          );
                        }
                        return (
                          <label key={opt.id} className="flex items-start gap-2.5 cursor-pointer group"
                            onClick={() => handleSingleSelect(q.id, opt.id)}>
                            <div className={`w-5 h-5 mt-0.5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                              isSelected ? "border-primary" : "border-border group-hover:border-primary/50"
                            }`}>
                              {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
                            </div>
                            <span className="text-sm leading-snug">{opt.text}</span>
                          </label>
                        );
                      })}
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
              <Button className="mt-2" loading={finish.isPending} onClick={() => finish.mutate()}>
                Завершить тест ЕНТ
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
