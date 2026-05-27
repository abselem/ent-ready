"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Topic { id: number; name: string }
interface Subtopic { id: number; topic_id: number; name: string }
interface BankQuestion {
  id: number; text: string; points: number; difficulty: number;
  explanation: string | null;
  topic_id: number | null; subtopic_id: number | null;
  topic_name: string | null; subtopic_name: string | null;
}

const DIFFICULTY_LABELS: Record<number, string> = { 1: "Лёгкий", 2: "Средний", 3: "Сложный" };
const DIFFICULTY_COLORS: Record<number, string> = {
  1: "bg-green-100 text-green-700",
  2: "bg-yellow-100 text-yellow-700",
  3: "bg-red-100 text-red-700",
};

export default function QuestionBankPage() {
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  // form fields
  const [text, setText] = useState("");
  const [points, setPoints] = useState("1");
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(1);
  const [topicId, setTopicId] = useState<number | "">("");
  const [subtopicId, setSubtopicId] = useState<number | "">("");
  const [explanation, setExplanation] = useState("");
  const [newTopicName, setNewTopicName] = useState("");
  const [newSubtopicName, setNewSubtopicName] = useState("");

  const [filterTopic, setFilterTopic] = useState<number | "">("");

  const { data: questions = [], isLoading } = useQuery<BankQuestion[]>({
    queryKey: ["my-questions"],
    queryFn: async () => (await api.get("/questions/mine")).data,
  });

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data,
  });

  const { data: subtopics = [] } = useQuery<Subtopic[]>({
    queryKey: ["subtopics", topicId],
    queryFn: async () => topicId ? (await api.get(`/topics/${topicId}/subtopics`)).data : [],
    enabled: !!topicId,
  });

  function resetForm() {
    setText(""); setPoints("1"); setDifficulty(1); setTopicId(""); setSubtopicId("");
    setExplanation(""); setNewTopicName(""); setNewSubtopicName(""); setEditId(null);
  }

  const createQuestion = useMutation({
    mutationFn: () => api.post("/questions", {
      text, points: Number(points), difficulty,
      topic_id: topicId || null,
      subtopic_id: subtopicId || null,
      explanation: explanation || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-questions"] });
      resetForm(); setShowForm(false);
    },
  });

  const updateQuestion = useMutation({
    mutationFn: (id: number) => api.put(`/questions/${id}`, {
      text, points: Number(points), difficulty,
      topic_id: topicId || null,
      subtopic_id: subtopicId || null,
      explanation: explanation || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-questions"] });
      resetForm(); setShowForm(false);
    },
  });

  const deleteQuestion = useMutation({
    mutationFn: (id: number) => api.delete(`/questions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-questions"] }),
  });

  const createTopic = useMutation({
    mutationFn: (name: string) => api.post("/topics", { name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["topics"] });
      setTopicId(res.data.id); setNewTopicName("");
    },
  });

  const createSubtopic = useMutation({
    mutationFn: (name: string) => api.post(`/topics/${topicId}/subtopics`, { name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["subtopics", topicId] });
      setSubtopicId(res.data.id); setNewSubtopicName("");
    },
  });

  function startEdit(q: BankQuestion) {
    setEditId(q.id);
    setText(q.text); setPoints(String(q.points));
    setDifficulty((q.difficulty as 1 | 2 | 3) || 1);
    setTopicId(q.topic_id ?? ""); setSubtopicId(q.subtopic_id ?? "");
    setExplanation(q.explanation ?? "");
    setShowForm(true);
  }

  const displayed = filterTopic
    ? questions.filter((q) => q.topic_id === filterTopic)
    : questions;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Банк вопросов</h1>
        <Button onClick={() => { resetForm(); setShowForm(!showForm); }}>
          {showForm ? "Отмена" : "Новый вопрос"}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{editId ? "Редактировать вопрос" : "Новый вопрос"}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <Input id="qtext" label="Текст вопроса" placeholder="Введите вопрос..."
                value={text} onChange={(e) => setText(e.target.value)} />
              <Input id="qpoints" label="Баллы" type="number" min="1"
                value={points} onChange={(e) => setPoints(e.target.value)} />

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Сложность</label>
                <div className="flex rounded-lg border border-border overflow-hidden">
                  {([1, 2, 3] as const).map((d) => (
                    <button key={d} type="button" onClick={() => setDifficulty(d)}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${difficulty === d ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                      {DIFFICULTY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Topic */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Тематика <span className="text-muted-foreground font-normal">(необязательно)</span></label>
                <div className="flex gap-2">
                  <select value={topicId} onChange={(e) => { setTopicId(e.target.value ? Number(e.target.value) : ""); setSubtopicId(""); }}
                    className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                    <option value="">Без тематики</option>
                    <optgroup label="ЕНТ">
                      {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  </select>
                  <div className="flex gap-1">
                    <input className="border border-border rounded px-2 py-1 text-sm w-28 bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                      placeholder="Новая..." value={newTopicName} onChange={(e) => setNewTopicName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && newTopicName.trim()) { e.preventDefault(); createTopic.mutate(newTopicName.trim()); }}} />
                    <Button size="sm" variant="outline" onClick={() => newTopicName.trim() && createTopic.mutate(newTopicName.trim())}>+</Button>
                  </div>
                </div>
              </div>

              {topicId !== "" && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Подтематика <span className="text-muted-foreground font-normal">(необязательно)</span></label>
                  <div className="flex gap-2">
                    <select value={subtopicId} onChange={(e) => setSubtopicId(e.target.value ? Number(e.target.value) : "")}
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

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Пояснение <span className="text-muted-foreground font-normal">(необязательно)</span></label>
                <textarea className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  rows={2} placeholder="Объяснение правильного ответа..."
                  value={explanation} onChange={(e) => setExplanation(e.target.value)} />
              </div>

              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => {
                  if (!text.trim()) return;
                  if (editId) updateQuestion.mutate(editId);
                  else createQuestion.mutate();
                }} loading={createQuestion.isPending || updateQuestion.isPending} disabled={!text.trim()}>
                  {editId ? "Сохранить" : "Создать вопрос"}
                </Button>
                {editId && (
                  <Button variant="outline" onClick={() => { resetForm(); setShowForm(false); }}>Отмена</Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Topic filter */}
      {questions.length > 0 && (
        <div className="mb-4">
          <select value={filterTopic} onChange={(e) => setFilterTopic(e.target.value ? Number(e.target.value) : "")}
            className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary w-full">
            <option value="">Все тематики</option>
            <optgroup label="ЕНТ">
              {topics
                .filter((t) => questions.some((q) => q.topic_id === t.id))
                .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет вопросов в банке</div>
      ) : (
        <div className="flex flex-col gap-3">
          {displayed.map((q) => (
            <Card key={q.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-sm font-medium leading-snug">{q.text}</CardTitle>
                    <div className="flex gap-2 mt-1.5 flex-wrap items-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DIFFICULTY_COLORS[q.difficulty] ?? "bg-muted text-muted-foreground"}`}>
                        {DIFFICULTY_LABELS[q.difficulty] ?? "—"}
                      </span>
                      <span className="text-xs text-muted-foreground">{q.points} б.</span>
                      {q.topic_name && (
                        <>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">{q.topic_name}</span>
                        </>
                      )}
                      {q.subtopic_name && (
                        <>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">{q.subtopic_name}</span>
                        </>
                      )}
                    </div>
                    {q.explanation && (
                      <p className="text-xs text-muted-foreground italic mt-1.5">💡 {q.explanation}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => startEdit(q)}>✏️</Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteQuestion.mutate(q.id)}
                      className="text-destructive hover:text-destructive">✕</Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
