"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { api, apiOrigin } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Lesson { id: number; title: string; group_id: number }
interface Block {
  id: number;
  type: string;
  content: string;
  language: string;
  caption: string;
  order_num: number;
}

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

  const { data: lesson } = useQuery<Lesson>({
    queryKey: ["lesson", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}`)).data,
    enabled: !!lessonId,
  });

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
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate">{lesson?.title ?? "..."}</h1>
          <p className="text-xs text-muted-foreground">Редактор содержимого</p>
        </div>
        <button
          onClick={() => router.push(`/teacher/lessons/${lessonId}/preview`)}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 transition-colors"
        >
          Предпросмотр ↗
        </button>
      </div>

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
