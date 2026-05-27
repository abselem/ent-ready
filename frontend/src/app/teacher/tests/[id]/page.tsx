"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface AnswerOption { id: number; text: string; is_correct: boolean }
interface Question {
  id: number; text: string; order_num: number; points: number;
  difficulty: number; topic_id: number | null; subtopic_id: number | null; explanation: string | null;
  options: AnswerOption[];
}
interface TestFull {
  id: number; title: string; is_published: boolean; is_public: boolean;
  max_attempts: number; time_limit: number | null; questions: Question[];
}
interface Topic { id: number; name: string }
interface Subtopic { id: number; topic_id: number; name: string }
interface BankQuestion {
  id: number; text: string; points: number; explanation: string | null;
  topic_id: number | null; subtopic_id: number | null;
  topic_name: string | null; subtopic_name: string | null;
}

export default function TestEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  // form state
  const [newQuestion, setNewQuestion] = useState("");
  const [newPoints, setNewPoints] = useState("1");
  const [newDifficulty, setNewDifficulty] = useState<1 | 2 | 3>(1);
  const [newTopicId, setNewTopicId] = useState<number | "">("");
  const [newSubtopicId, setNewSubtopicId] = useState<number | "">("");
  const [newExplanation, setNewExplanation] = useState("");
  const [newOptionTexts, setNewOptionTexts] = useState<Record<number, string>>({});
  const [tab, setTab] = useState<"new" | "bank">("new");

  // topic creation
  const [newTopicName, setNewTopicName] = useState("");
  const [newSubtopicName, setNewSubtopicName] = useState("");
  const [bankFilter, setBankFilter] = useState<number | "">("");

  const { data: test, isLoading } = useQuery<TestFull>({
    queryKey: ["test-full", id],
    queryFn: async () => {
      const { data } = await api.get(`/tests/${id}`);
      return { ...data.test, questions: data.questions ?? [] };
    },
  });

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data,
  });

  const { data: subtopics = [] } = useQuery<Subtopic[]>({
    queryKey: ["subtopics", newTopicId],
    queryFn: async () => newTopicId ? (await api.get(`/topics/${newTopicId}/subtopics`)).data : [],
    enabled: !!newTopicId,
  });

  const { data: bankQuestions = [] } = useQuery<BankQuestion[]>({
    queryKey: ["my-questions"],
    queryFn: async () => (await api.get("/questions/mine")).data,
    enabled: tab === "bank",
  });

  const publishTest = useMutation({
    mutationFn: () => api.post(`/tests/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-full", id] }),
  });

  const addQuestion = useMutation({
    mutationFn: () => api.post(`/tests/${id}/questions`, {
      text: newQuestion,
      points: Number(newPoints),
      difficulty: newDifficulty,
      topic_id: newTopicId || null,
      subtopic_id: newSubtopicId || null,
      explanation: newExplanation || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["test-full", id] });
      qc.invalidateQueries({ queryKey: ["my-questions"] });
      setNewQuestion(""); setNewPoints("1"); setNewDifficulty(1); setNewTopicId(""); setNewSubtopicId(""); setNewExplanation("");
    },
  });

  const linkQuestion = useMutation({
    mutationFn: (questionId: number) => api.post(`/tests/${id}/questions/link`, { question_id: questionId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-full", id] }),
  });

  const unlinkQuestion = useMutation({
    mutationFn: (qid: number) => api.delete(`/tests/${id}/questions/${qid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-full", id] }),
  });

  const addOption = useMutation({
    mutationFn: ({ qid, text }: { qid: number; text: string }) =>
      api.post(`/questions/${qid}/options`, { text, is_correct: false }),
    onSuccess: (_, { qid }) => {
      qc.invalidateQueries({ queryKey: ["test-full", id] });
      setNewOptionTexts((prev) => ({ ...prev, [qid]: "" }));
    },
  });

  const toggleCorrect = useMutation({
    mutationFn: ({ oid, text, isCorrect }: { oid: number; text: string; isCorrect: boolean }) =>
      api.put(`/options/${oid}`, { text, is_correct: isCorrect }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-full", id] }),
  });

  const deleteOption = useMutation({
    mutationFn: (oid: number) => api.delete(`/options/${oid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["test-full", id] }),
  });

  const createTopic = useMutation({
    mutationFn: (name: string) => api.post("/topics", { name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["topics"] });
      setNewTopicId(res.data.id);
      setNewTopicName("");
    },
  });

  const createSubtopic = useMutation({
    mutationFn: (name: string) => api.post(`/topics/${newTopicId}/subtopics`, { name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["subtopics", newTopicId] });
      setNewSubtopicId(res.data.id);
      setNewSubtopicName("");
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Загрузка...</div>;
  if (!test) return null;

  const alreadyInTest = new Set(test.questions.map((q) => q.id));
  const filteredBank = bankFilter
    ? bankQuestions.filter((q) => q.topic_id === bankFilter)
    : bankQuestions;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">{test.title}</h1>
        <div className="flex gap-2 items-center flex-wrap">
          <Button variant="outline" size="sm" onClick={() => router.push(`/teacher/tests/${id}/preview`)}>
            Предпросмотр
          </Button>
          {test.is_published && (
            <Button variant="outline" size="sm" onClick={() => router.push(`/teacher/tests/${id}/results`)}>
              Результаты
            </Button>
          )}
          {!test.is_published && (
            <Button variant="outline" size="sm" onClick={() => publishTest.mutate()} loading={publishTest.isPending}>
              Опубликовать
            </Button>
          )}
          {test.is_published && (
            <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">Опубликован</span>
          )}
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Попыток: {test.max_attempts}
        {test.time_limit ? ` · Время: ${test.time_limit} мин` : ""}
        {" · "}{test.is_public ? "Публичный" : "Приватный"}
      </p>

      {/* Questions list */}
      <div className="flex flex-col gap-4 mb-6">
        {test.questions.map((q, qi) => (
          <Card key={q.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <CardTitle className="text-sm font-medium">{qi + 1}. {q.text}</CardTitle>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">{q.points} б.</span>
                    <span className="text-xs text-muted-foreground">· {{ 1: "Лёгкий", 2: "Средний", 3: "Сложный" }[q.difficulty] ?? "—"}</span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => unlinkQuestion.mutate(q.id)}>✕</Button>
              </div>
            </CardHeader>
            <CardContent>
              {q.explanation && (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5 mb-3 italic">
                  💡 {q.explanation}
                </div>
              )}
              <div className="flex flex-col gap-2">
                {q.options.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <button
                      onClick={() => toggleCorrect.mutate({ oid: opt.id, text: opt.text, isCorrect: !opt.is_correct })}
                      className={`w-5 h-5 rounded border-2 shrink-0 transition-colors ${opt.is_correct ? "bg-primary border-primary" : "border-border"}`}
                    />
                    <span className="text-sm flex-1">{opt.text}</span>
                    <button onClick={() => deleteOption.mutate(opt.id)} className="text-muted-foreground hover:text-destructive text-xs">✕</button>
                  </div>
                ))}
                <div className="flex gap-2 mt-1">
                  <input
                    className="flex-1 text-sm border border-border rounded px-2 py-1 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Новый вариант ответа"
                    value={newOptionTexts[q.id] ?? ""}
                    onChange={(e) => setNewOptionTexts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); const t = newOptionTexts[q.id]?.trim(); if (t) addOption.mutate({ qid: q.id, text: t }); }
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={() => { const t = newOptionTexts[q.id]?.trim(); if (t) addOption.mutate({ qid: q.id, text: t }); }}>+</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add question panel */}
      {!test.is_published && (
        <Card>
          <CardHeader>
            <div className="flex gap-0 rounded-lg border border-border overflow-hidden">
              <button onClick={() => setTab("new")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "new" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                Новый вопрос
              </button>
              <button onClick={() => setTab("bank")}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "bank" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                Из банка
              </button>
            </div>
          </CardHeader>

          {tab === "new" && (
            <CardContent>
              <div className="flex flex-col gap-3">
                <Input id="nq" label="Текст вопроса" placeholder="Введите вопрос..." value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} />
                <Input id="np" label="Баллы" type="number" min="1" value={newPoints} onChange={(e) => setNewPoints(e.target.value)} />

                {/* Difficulty */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Сложность</label>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {([1, 2, 3] as const).map((d) => {
                      const labels = { 1: "Лёгкий", 2: "Средний", 3: "Сложный" };
                      return (
                        <button key={d} type="button" onClick={() => setNewDifficulty(d)}
                          className={`flex-1 py-2 text-sm font-medium transition-colors ${newDifficulty === d ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                          {labels[d]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Topic */}
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Тематика <span className="text-muted-foreground font-normal">(необязательно)</span></label>
                  <div className="flex gap-2">
                    <select value={newTopicId} onChange={(e) => { setNewTopicId(e.target.value ? Number(e.target.value) : ""); setNewSubtopicId(""); }}
                      className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                      <option value="">Без тематики</option>
                      {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <div className="flex gap-1">
                      <input className="border border-border rounded px-2 py-1 text-sm w-28 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Новая..." value={newTopicName} onChange={(e) => setNewTopicName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && newTopicName.trim()) { e.preventDefault(); createTopic.mutate(newTopicName.trim()); }}} />
                      <Button size="sm" variant="outline" onClick={() => newTopicName.trim() && createTopic.mutate(newTopicName.trim())}>+</Button>
                    </div>
                  </div>
                </div>

                {/* Subtopic */}
                {newTopicId !== "" && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">Подтематика <span className="text-muted-foreground font-normal">(необязательно)</span></label>
                    <div className="flex gap-2">
                      <select value={newSubtopicId} onChange={(e) => setNewSubtopicId(e.target.value ? Number(e.target.value) : "")}
                        className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                        <option value="">Без подтематики</option>
                        {subtopics.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <div className="flex gap-1">
                        <input className="border border-border rounded px-2 py-1 text-sm w-28 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="Новая..." value={newSubtopicName} onChange={(e) => setNewSubtopicName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && newSubtopicName.trim()) { e.preventDefault(); createSubtopic.mutate(newSubtopicName.trim()); }}} />
                        <Button size="sm" variant="outline" onClick={() => newSubtopicName.trim() && createSubtopic.mutate(newSubtopicName.trim())}>+</Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Explanation */}
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Пояснение к ответу <span className="text-muted-foreground font-normal">(необязательно)</span></label>
                  <textarea className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    rows={2} placeholder="Объяснение правильного ответа..."
                    value={newExplanation} onChange={(e) => setNewExplanation(e.target.value)} />
                </div>

                <Button onClick={() => newQuestion.trim() && addQuestion.mutate()} loading={addQuestion.isPending} disabled={!newQuestion.trim()}>
                  Добавить вопрос
                </Button>
              </div>
            </CardContent>
          )}

          {tab === "bank" && (
            <CardContent>
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <select value={bankFilter} onChange={(e) => setBankFilter(e.target.value ? Number(e.target.value) : "")}
                    className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">Все тематики</option>
                    {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                {filteredBank.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Нет вопросов в банке</p>
                ) : (
                  <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                    {filteredBank.map((q) => {
                      const added = alreadyInTest.has(q.id);
                      return (
                        <div key={q.id} className={`flex items-start justify-between gap-3 border rounded-lg p-3 ${added ? "opacity-50" : ""}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium leading-snug">{q.text}</p>
                            <div className="flex gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                              {q.topic_name && <span>{q.topic_name}</span>}
                              {q.subtopic_name && <><span>·</span><span>{q.subtopic_name}</span></>}
                              <span>· {q.points} б.</span>
                            </div>
                            {q.explanation && <p className="text-xs text-muted-foreground italic mt-1">💡 {q.explanation}</p>}
                          </div>
                          <Button size="sm" variant="outline" disabled={added} onClick={() => linkQuestion.mutate(q.id)}>
                            {added ? "Добавлен" : "+ Добавить"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
