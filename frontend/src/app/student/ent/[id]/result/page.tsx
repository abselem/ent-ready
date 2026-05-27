"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface ENTOptionResult { id: number; text: string; order_num: number; is_correct: boolean }
interface ENTQuestionResult {
  id: number; text: string; is_multi: boolean; is_correct: boolean;
  order_num: number; options: ENTOptionResult[]; selected: number[];
}
interface ENTSectionResult {
  slot: number; topic_id: number; topic_name: string;
  score: number; max_score: number; questions: ENTQuestionResult[];
}
interface ENTResultData {
  attempt: { id: number; started_at: string; finished_at: string };
  sections: ENTSectionResult[];
  total_score: number;
  total_max: number;
}

const DIFF_COLOR = ["bg-green-100 text-green-700", "bg-yellow-100 text-yellow-700", "bg-red-100 text-red-700"];

function ScoreBar({ score, max }: { score: number; max: number }) {
  const p = max ? Math.round((score / max) * 100) : 0;
  return (
    <div className="mt-2">
      <div className="h-2 bg-muted rounded-full">
        <div className={`h-full rounded-full transition-all ${p >= 80 ? "bg-green-500" : p >= 50 ? "bg-yellow-500" : "bg-destructive"}`}
          style={{ width: `${p}%` }} />
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{p}%</p>
    </div>
  );
}

export default function ENTResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data, isLoading } = useQuery<ENTResultData>({
    queryKey: ["ent-result", id],
    queryFn: async () => (await api.get(`/ent/attempts/${id}/result`)).data,
  });

  if (isLoading || !data) return <div className="p-6 text-muted-foreground">Загрузка...</div>;

  const { sections, total_score, total_max } = data;
  const totalPct = total_max ? Math.round((total_score / total_max) * 100) : 0;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6 gap-2">
        <h1 className="text-2xl font-bold">Результаты ЕНТ</h1>
        <Button variant="outline" size="sm" onClick={() => router.push("/student/ent")}>← Назад</Button>
      </div>

      {/* Total score card */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Итоговый балл</span>
            <span className={`text-3xl font-bold ${totalPct >= 80 ? "text-green-600" : totalPct >= 50 ? "text-yellow-600" : "text-destructive"}`}>
              {total_score}<span className="text-lg text-muted-foreground font-normal">/{total_max}</span>
            </span>
          </div>
          <ScoreBar score={total_score} max={total_max} />

          {/* Per-subject summary */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            {sections.map((s) => (
              <div key={s.slot} className="border border-border rounded-lg p-3">
                <p className="text-xs text-muted-foreground leading-tight mb-1 truncate">{s.topic_name}</p>
                <div className="flex items-end justify-between">
                  <span className={`text-lg font-bold ${s.score / s.max_score >= 0.8 ? "text-green-600" : s.score / s.max_score >= 0.5 ? "text-yellow-600" : "text-destructive"}`}>
                    {s.score}
                  </span>
                  <span className="text-xs text-muted-foreground">/{s.max_score}</span>
                </div>
                <ScoreBar score={s.score} max={s.max_score} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Per-section breakdown */}
      {sections.map((section) => (
        <div key={section.slot} className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-base font-semibold">{section.topic_name}</h2>
            <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${
              section.score / section.max_score >= 0.8 ? "bg-green-100 text-green-700"
              : section.score / section.max_score >= 0.5 ? "bg-yellow-100 text-yellow-700"
              : "bg-red-100 text-red-700"
            }`}>
              {section.score}/{section.max_score}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {section.questions.map((q, qi) => (
              <Card key={q.id} className={q.is_correct ? "border-green-200" : "border-red-200"}>
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-2">
                    <span className={`shrink-0 w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold mt-0.5 ${
                      q.is_correct ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    }`}>
                      {q.is_correct ? "✓" : "✗"}
                    </span>
                    <div className="flex-1">
                      <CardTitle className="text-sm font-medium leading-snug">
                        {qi + 1}. {q.text}
                      </CardTitle>
                      {q.is_multi && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 mt-1 inline-block">
                          Несколько ответов
                        </span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col gap-1.5">
                    {q.options.map((opt) => {
                      const isSelected = q.selected.includes(opt.id);
                      const isCorrect = opt.is_correct;
                      let cls = "border-border text-foreground";
                      if (isSelected && isCorrect) cls = "border-green-400 bg-green-50 text-green-800";
                      else if (isSelected && !isCorrect) cls = "border-red-400 bg-red-50 text-red-800";
                      else if (!isSelected && isCorrect) cls = "border-green-300 bg-green-50/50 text-green-700";
                      return (
                        <div key={opt.id} className={`flex items-center gap-2 border rounded-md px-3 py-1.5 text-sm ${cls}`}>
                          <span className="shrink-0 text-xs">
                            {isSelected && isCorrect ? "✓" : isSelected && !isCorrect ? "✗" : isCorrect ? "◎" : "○"}
                          </span>
                          <span>{opt.text}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      <Button className="w-full" onClick={() => router.push("/student/ent")}>
        Пройти ещё раз
      </Button>
    </div>
  );
}
