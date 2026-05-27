"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface ENTAttempt {
  id: number;
  started_at: string;
  finished_at: string | null;
  subject3_id: number | null;
  subject4_id: number | null;
  subject3_name: string;
  subject4_name: string;
  score1: number | null;
  score2: number | null;
  score3: number | null;
  score4: number | null;
  total_score: number;
  total_max: number;
}

const SLOT_LABELS = ["Мат. грамотность", "История Казахстана"];
const SLOT_MAX = [10, 20, 50, 50];

export default function ENTPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const hasSubjects = !!(user?.profile_subject1 && user?.profile_subject2);

  const { data: attempts = [], isLoading, refetch } = useQuery<ENTAttempt[]>({
    queryKey: ["ent-attempts"],
    queryFn: async () => (await api.get("/ent/attempts/my")).data,
  });

  const startQuiz = useMutation({
    mutationFn: () => api.post("/ent/start"),
    onSuccess: (res) => {
      router.push(`/student/ent/${res.data.attempt.id}`);
    },
  });

  function formatDate(ts: string) {
    return new Date(ts).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function pct(score: number, max: number) {
    if (!max) return 0;
    return Math.round((score / max) * 100);
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">ЕНТ Пробный тест</h1>
      <p className="text-sm text-muted-foreground mb-6">
        110 вопросов · 4 предмета · Мат. грамотность + История Казахстана + 2 профильных
      </p>

      {/* Structure info */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              { name: "Мат. грамотность", info: "3 лёгких + 3 средних + 4 сложных", max: 10 },
              { name: "История Казахстана", info: "6 лёгких + 7 средних + 7 сложных", max: 20 },
              { name: "Профильный 1", info: "30 одиночных + 10 множественных", max: 50 },
              { name: "Профильный 2", info: "30 одиночных + 10 множественных", max: 50 },
            ].map((s) => (
              <div key={s.name} className="border border-border rounded-lg p-3">
                <p className="font-medium text-sm">{s.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.info}</p>
                <p className="text-xs font-semibold text-primary mt-1">макс. {s.max} б.</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
            <span>Итого вопросов: <b className="text-foreground">110</b></span>
            <span>Максимум баллов: <b className="text-foreground">130</b></span>
          </div>
        </CardContent>
      </Card>

      {!hasSubjects && (
        <div className="mb-4 p-3 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 text-sm text-yellow-800 dark:text-yellow-300">
          Для старта теста выберите два профильных предмета в{" "}
          <button className="underline font-medium" onClick={() => router.push("/student/profile")}>
            профиле
          </button>
          .
        </div>
      )}

      <Button
        className="w-full mb-8"
        disabled={!hasSubjects || startQuiz.isPending}
        loading={startQuiz.isPending}
        onClick={() => startQuiz.mutate()}
      >
        Начать пробный ЕНТ
      </Button>

      {/* History */}
      <h2 className="text-lg font-semibold mb-3">История попыток</h2>
      {isLoading ? (
        <div className="text-center text-muted-foreground py-8">Загрузка...</div>
      ) : attempts.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">Нет попыток</div>
      ) : (
        <div className="flex flex-col gap-3">
          {attempts.map((a) => {
            const finished = !!a.finished_at;
            const p = pct(a.total_score, a.total_max);
            return (
              <Card key={a.id}
                className="cursor-pointer hover:border-primary transition-colors"
                onClick={() => finished ? router.push(`/student/ent/${a.id}/result`) : router.push(`/student/ent/${a.id}`)}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm font-medium">
                        {a.subject3_name} · {a.subject4_name}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatDate(a.started_at)}</p>
                    </div>
                    {finished ? (
                      <span className={`text-sm font-bold shrink-0 ${p >= 80 ? "text-green-600" : p >= 50 ? "text-yellow-600" : "text-destructive"}`}>
                        {a.total_score}/{a.total_max}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">В процессе</span>
                    )}
                  </div>
                </CardHeader>
                {finished && (
                  <CardContent>
                    <div className="h-1.5 bg-muted rounded-full mb-2">
                      <div className={`h-full rounded-full ${p >= 80 ? "bg-green-500" : p >= 50 ? "bg-yellow-500" : "bg-destructive"}`}
                        style={{ width: `${p}%` }} />
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-xs text-center">
                      {[a.score1, a.score2, a.score3, a.score4].map((s, i) => (
                        <div key={i} className="bg-muted/50 rounded px-1 py-1">
                          <p className="text-muted-foreground truncate">{i < 2 ? SLOT_LABELS[i] : (i === 2 ? a.subject3_name : a.subject4_name)}</p>
                          <p className="font-semibold">{s ?? 0}/{SLOT_MAX[i]}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
