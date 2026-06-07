"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { api, apiOrigin } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Lesson {
  id: number;
  title: string;
  is_published: boolean;
  visibility: string;
  view_count: number;
  topic_id: number | null;
  topic_name: string;
  subtopic_id: number | null;
  subtopic_name: string;
}
interface Block {
  id: number;
  type: string;
  content: string;
  language: string;
  caption: string;
  order_num: number;
}
interface Topic { id: number; name: string }
interface Subtopic { id: number; topic_id: number; name: string }

const BLOCK_TYPES = [
  { value: "text",  label: "Текст",         icon: "¶" },
  { value: "code",  label: "Код",           icon: "</>" },
  { value: "image", label: "Изображение",   icon: "🖼" },
  { value: "note",  label: "Заметка",       icon: "ℹ" },
];

const TYPE_COLORS: Record<string, string> = {
  text:  "bg-blue-500/10 text-blue-400",
  code:  "bg-green-500/10 text-green-400",
  image: "bg-purple-500/10 text-purple-400",
  note:  "bg-yellow-500/10 text-yellow-400",
};

export default function TeacherLessonEditor() {
  const { id } = useParams();
  const lessonId = Number(id);
  const router = useRouter();
  const qc = useQueryClient();
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showAccessPanel, setShowAccessPanel] = useState(false);
  const [showTopicPanel, setShowTopicPanel] = useState(false);
  const [topicId, setTopicId] = useState<number | "">("");
  const [subtopicId, setSubtopicId] = useState<number | "">("");

  const { data: lesson, refetch: refetchLesson } = useQuery<Lesson>({
    queryKey: ["lesson", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}`)).data,
    enabled: !!lessonId,
  });

  useEffect(() => {
    if (lesson) {
      setTopicId(lesson.topic_id || "");
      setSubtopicId(lesson.subtopic_id || "");
    }
  }, [lesson]);

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data,
  });

  const { data: allSubtopics = [] } = useQuery<Subtopic[]>({
    queryKey: ["subtopics"],
    queryFn: async () => (await api.get("/subtopics")).data,
  });

  const subtopicsForTopic = topicId
    ? allSubtopics.filter(st => st.topic_id === Number(topicId))
    : [];

  const { data: blocks = [], isLoading } = useQuery<Block[]>({
    queryKey: ["lesson-blocks", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}/blocks`)).data,
    enabled: !!lessonId,
  });

  const createBlock = useMutation({
    mutationFn: (type: string) =>
      api.post(`/lessons/${lessonId}/blocks`, { type, content: "", language: "", caption: "" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lesson-blocks", lessonId] }),
  });

  const updateBlock = useMutation({
    mutationFn: ({ id, ...data }: { id: number; content: string; language: string; caption: string }) =>
      api.put(`/lesson-blocks/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lesson-blocks", lessonId] }),
  });

  const deleteBlock = useMutation({
    mutationFn: (blockId: number) => api.delete(`/lesson-blocks/${blockId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lesson-blocks", lessonId] }),
  });

  const reorderBlocks = useMutation({
    mutationFn: (order: { id: number; order_num: number }[]) =>
      api.post(`/lessons/${lessonId}/blocks/reorder`, { order }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lesson-blocks", lessonId] }),
  });

  const publishLesson = useMutation({
    mutationFn: (vis: string) => api.post(`/lessons/${lessonId}/publish`, { visibility: vis }),
    onSuccess: () => { refetchLesson(); },
  });

  const unpublishLesson = useMutation({
    mutationFn: () => api.post(`/lessons/${lessonId}/unpublish`),
    onSuccess: () => { refetchLesson(); },
  });

  const updateTopics = useMutation({
    mutationFn: () => api.put(`/lessons/${lessonId}/topics`, {
      topic_id: topicId ? Number(topicId) : null,
      subtopic_id: subtopicId ? Number(subtopicId) : null,
    }),
    onSuccess: () => {
      refetchLesson();
      qc.invalidateQueries({ queryKey: ["teacher-lessons-mine"] });
      setShowTopicPanel(false);
    },
  });

  function handleMove(blockId: number, dir: -1 | 1) {
    const idx = blocks.findIndex(b => b.id === blockId);
    if ((dir === -1 && idx === 0) || (dir === 1 && idx === blocks.length - 1)) return;
    const current = blocks[idx];
    const other = blocks[idx + dir];
    reorderBlocks.mutate([
      { id: current.id, order_num: other.order_num },
      { id: other.id, order_num: current.order_num },
    ]);
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/teacher/lessons")}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold truncate">{lesson?.title ?? "..."}</h1>
            {lesson && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                lesson.is_published ? "bg-green-500/10 text-green-400" : "bg-muted text-muted-foreground"
              }`}>
                {lesson.is_published ? "Опубликован" : "Черновик"}
              </span>
            )}
          </div>
          {lesson?.is_published && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {lesson.view_count} просмотр{lesson.view_count === 1 ? "" : lesson.view_count < 5 ? "а" : "ов"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => router.push(`/teacher/lessons/${lessonId}/viewers`)}
            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
          >
            👁 Просмотры
          </button>
          <button
            onClick={() => router.push(`/teacher/lessons/${lessonId}/preview`)}
            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
          >
            Предпросмотр ↗
          </button>
          <button
            onClick={() => setShowTopicPanel(!showTopicPanel)}
            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
          >
            📚 Тема
          </button>
          {lesson && !lesson.is_published ? (
            <button
              onClick={() => setShowAccessPanel(!showAccessPanel)}
              className="text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 hover:bg-primary/90 transition-colors"
            >
              Опубликовать
            </button>
          ) : lesson?.is_published ? (
            <button
              onClick={() => unpublishLesson.mutate()}
              className="text-xs border border-border rounded-lg px-3 py-1.5 text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
            >
              Снять
            </button>
          ) : null}
        </div>
      </div>

      {/* Publish panel */}
      {showAccessPanel && lesson && !lesson.is_published && (
        <div className="mb-5 border border-primary/30 bg-primary/5 rounded-2xl p-4">
          <p className="text-sm font-semibold mb-3">Выберите аудиторию</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {(["all","school","course","private"] as const).map(v => {
              const labels: Record<string, {label: string; desc: string}> = {
                all:     { label: "Для всех",  desc: "Все пользователи" },
                school:  { label: "Школа",     desc: "Мои школьные группы" },
                course:  { label: "Курс",      desc: "Мои курсы" },
                private: { label: "Приватный", desc: "Явный доступ" },
              };
              return (
                <button key={v} onClick={() => publishLesson.mutate(v)}
                  disabled={publishLesson.isPending}
                  className="p-3 rounded-xl border border-border bg-card hover:border-primary text-left transition-colors disabled:opacity-50">
                  <p className="text-sm font-medium">{labels[v].label}</p>
                  <p className="text-xs text-muted-foreground">{labels[v].desc}</p>
                </button>
              );
            })}
          </div>
          <button onClick={() => setShowAccessPanel(false)} className="text-xs text-muted-foreground hover:text-foreground">
            Отмена
          </button>
        </div>
      )}

      {/* Topic panel */}
      {showTopicPanel && (
        <div className="mb-5 border border-blue-500/30 bg-blue-500/5 rounded-2xl p-4">
          <p className="text-sm font-semibold mb-3">Выберите тему и подтему</p>
          <div className="flex flex-col gap-3 mb-3">
            <div>
              <label className="text-xs font-medium block mb-1">Предмет</label>
              <select
                value={topicId}
                onChange={e => {
                  setTopicId(e.target.value ? Number(e.target.value) : "");
                  setSubtopicId("");
                }}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">— Не выбран —</option>
                {topics.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            {topicId && subtopicsForTopic.length > 0 && (
              <div>
                <label className="text-xs font-medium block mb-1">Подтема</label>
                <select
                  value={subtopicId}
                  onChange={e => setSubtopicId(e.target.value ? Number(e.target.value) : "")}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">— Не выбрана —</option>
                  {subtopicsForTopic.map(st => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              loading={updateTopics.isPending}
              onClick={() => updateTopics.mutate()}
            >
              Сохранить
            </Button>
            <button
              onClick={() => setShowTopicPanel(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Private access management */}
      {lesson?.is_published && lesson.visibility === "private" && (
        <AccessPanel lessonId={lessonId} />
      )}

      {/* Blocks list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map(i => <div key={i} className="h-32 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.length === 0 && (
            <div className="text-center py-10 text-muted-foreground text-sm border-2 border-dashed border-border rounded-xl">
              Нет блоков. Добавьте первый блок ниже.
            </div>
          )}
          {blocks.map((block, idx) => (
            <BlockEditor
              key={block.id}
              block={block}
              isFirst={idx === 0}
              isLast={idx === blocks.length - 1}
              saving={updateBlock.isPending}
              onSave={data => updateBlock.mutate({ id: block.id, ...data })}
              onDelete={() => deleteBlock.mutate(block.id)}
              onMove={dir => handleMove(block.id, dir)}
            />
          ))}
        </div>
      )}

      {/* Add block */}
      <div className="relative mt-4">
        <button
          onClick={() => setShowTypeMenu(!showTypeMenu)}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl py-3 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Добавить блок
        </button>
        {showTypeMenu && (
          <div className="absolute bottom-full mb-2 left-0 right-0 bg-card border border-border rounded-xl overflow-hidden z-10 shadow-xl">
            {BLOCK_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => { createBlock.mutate(t.value); setShowTypeMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted transition-colors"
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${TYPE_COLORS[t.value] ?? ""}`}>
                  {t.icon}
                </span>
                <span className="font-medium">{t.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t.value === "text" && "Текстовый абзац"}
                  {t.value === "code" && "Блок кода с подсветкой"}
                  {t.value === "image" && "Изображение по URL"}
                  {t.value === "note" && "Выделенная заметка"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── AccessPanel ───────────────────────────────────────────────────────────────

interface AccessEntry { type: string; ref_id: number; name: string }
interface Group { id: number; name: string }
interface Student { id: number; first_name: string; last_name: string; phone: string }

function AccessPanel({ lessonId }: { lessonId: number }) {
  const qc = useQueryClient();
  const [addType, setAddType] = useState<"group" | "student">("group");
  const [selectedRef, setSelectedRef] = useState("");

  const { data: access = [] } = useQuery<AccessEntry[]>({
    queryKey: ["lesson-access", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}/access`)).data,
  });
  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data,
  });

  const grant = useMutation({
    mutationFn: ({ type, ref_id }: { type: string; ref_id: number }) =>
      api.post(`/lessons/${lessonId}/access`, { type, ref_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["lesson-access", lessonId] }); setSelectedRef(""); },
  });

  const revoke = useMutation({
    mutationFn: ({ type, ref_id }: { type: string; ref_id: number }) =>
      api.delete(`/lessons/${lessonId}/access/${type}/${ref_id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lesson-access", lessonId] }),
  });

  return (
    <div className="mb-5 border border-border rounded-2xl bg-card p-4">
      <p className="text-sm font-semibold mb-3">Управление доступом</p>

      {/* Add access */}
      <div className="flex gap-2 mb-3">
        <select value={addType} onChange={e => { setAddType(e.target.value as "group" | "student"); setSelectedRef(""); }}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-card focus:outline-none">
          <option value="group">Группа</option>
        </select>
        <select value={selectedRef} onChange={e => setSelectedRef(e.target.value)}
          className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-card focus:outline-none">
          <option value="">Выберите...</option>
          {groups.filter(g => !access.find(a => a.type === "group" && a.ref_id === g.id))
            .map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button onClick={() => { if (selectedRef) grant.mutate({ type: addType, ref_id: Number(selectedRef) }); }}
          disabled={!selectedRef || grant.isPending}
          className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg disabled:opacity-50 hover:bg-primary/90 transition-colors">
          Добавить
        </button>
      </div>

      {/* Current access list */}
      {access.length === 0 ? (
        <p className="text-xs text-muted-foreground">Нет предоставленного доступа.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {access.map(a => (
            <span key={`${a.type}-${a.ref_id}`}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-border bg-muted/30">
              <span className="text-muted-foreground">{a.type === "group" ? "Группа" : "Ученик"}:</span>
              <span>{a.name}</span>
              <button onClick={() => revoke.mutate({ type: a.type, ref_id: a.ref_id })}
                className="text-muted-foreground hover:text-destructive ml-0.5">✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

interface BlockEditorProps {
  block: Block;
  isFirst: boolean;
  isLast: boolean;
  saving: boolean;
  onSave: (data: { content: string; language: string; caption: string }) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}

function BlockEditor({ block, isFirst, isLast, saving, onSave, onDelete, onMove }: BlockEditorProps) {
  const [content, setContent] = useState(block.content);
  const [language, setLanguage] = useState(block.language);
  const [caption, setCaption] = useState(block.caption);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/upload/image", formData);
      const url = `${apiOrigin}${data.url}`;
      setContent(url);
      onSave({ content: url, language, caption });
    } catch {
      setUploadError("Ошибка загрузки. Попробуйте ещё раз.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  useEffect(() => {
    setContent(block.content);
    setLanguage(block.language);
    setCaption(block.caption);
    setDirty(false);
  }, [block.content, block.language, block.caption]);

  function handleBlur() {
    if (dirty) {
      onSave({ content, language, caption });
      setDirty(false);
    }
  }

  const typeCfg = BLOCK_TYPES.find(t => t.value === block.type) ?? BLOCK_TYPES[0];
  const colorCls = TYPE_COLORS[block.type] ?? "";

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border">
        <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${colorCls}`}>
          {typeCfg.icon} {typeCfg.label}
        </span>
        {dirty && (
          <span className="text-xs text-muted-foreground ml-1">· несохранено</span>
        )}
        {saving && <span className="text-xs text-muted-foreground ml-1">· сохранение...</span>}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => onMove(-1)} disabled={isFirst}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 hover:bg-muted transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m18 15-6-6-6 6"/></svg>
          </button>
          <button
            onClick={() => onMove(1)} disabled={isLast}
            className="p-1.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 hover:bg-muted transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded text-destructive hover:bg-destructive/10 transition-colors ml-1"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="p-3 flex flex-col gap-2">
        {block.type === "image" ? (
          <>
            {/* URL input */}
            <input
              type="url"
              value={content}
              onChange={e => { setContent(e.target.value); setDirty(true); }}
              onBlur={handleBlur}
              placeholder="https://... (вставьте URL)"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {/* Divider */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="flex-1 border-t border-border" />
              или
              <div className="flex-1 border-t border-border" />
            </div>

            {/* File upload */}
            <label className={`flex items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg px-3 py-2.5 text-sm cursor-pointer transition-colors ${
              uploading ? "opacity-50 cursor-not-allowed" : "hover:border-primary hover:text-primary"
            }`}>
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {uploading ? "Загрузка..." : "Загрузить с компьютера"}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.gif,.webp"
                className="hidden"
                disabled={uploading}
                onChange={handleFileChange}
              />
            </label>
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}

            {/* Caption */}
            <input
              type="text"
              value={caption}
              onChange={e => { setCaption(e.target.value); setDirty(true); }}
              onBlur={handleBlur}
              placeholder="Подпись к изображению (необязательно)"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
            />

            {/* Preview */}
            {content && (
              <div className="mt-1 rounded-lg overflow-hidden border border-border max-w-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={content} alt={caption || ""} className="max-w-full" />
              </div>
            )}
          </>
        ) : (
          <>
            {block.type === "code" && (
              <input
                type="text"
                value={language}
                onChange={e => { setLanguage(e.target.value); setDirty(true); }}
                onBlur={handleBlur}
                placeholder="Язык (go, python, javascript...)"
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              />
            )}
            <textarea
              value={content}
              onChange={e => { setContent(e.target.value); setDirty(true); }}
              onBlur={handleBlur}
              rows={block.type === "code" ? 10 : block.type === "note" ? 3 : 5}
              placeholder={
                block.type === "code"  ? "Введите код..." :
                block.type === "note"  ? "Текст заметки (будет выделен рамкой)..." :
                "Введите текст. Разделите абзацы пустой строкой."
              }
              className={`w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-card resize-y focus:outline-none focus:ring-2 focus:ring-primary leading-relaxed ${
                block.type === "code" ? "font-mono text-[13px]" : ""
              }`}
            />
          </>
        )}
      </div>
    </div>
  );
}
