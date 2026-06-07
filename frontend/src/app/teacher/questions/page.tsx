"use client";

import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiOrigin } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/math-text";

interface Topic { id: number; name: string }
interface Subtopic { id: number; topic_id: number; name: string }
interface BankQuestion {
  id: number; text: string; difficulty: number; question_type: string;
  explanation: string | null; image_url: string | null; explanation_image_url: string | null;
  topic_id: number | null; subtopic_id: number | null;
  topic_name: string | null; subtopic_name: string | null;
}
interface BankContext {
  id: number; title: string | null; body: string; image_url: string | null;
  topic_id: number | null; topic_name: string | null; subtopic_name: string | null;
  question_count: number;
}

const DIFF: Record<number, { label: string; color: string }> = {
  1: { label: "Лёгкий",  color: "bg-green-500/10 text-green-400" },
  2: { label: "Средний", color: "bg-yellow-500/10 text-yellow-400" },
  3: { label: "Сложный", color: "bg-red-500/10 text-red-400" },
};

// ── Searchable combobox ────────────────────────────────────────────────────────
function SearchSelect({
  options, value, onChange, placeholder, required,
}: {
  options: { id: number; name: string }[];
  value: number | "";
  onChange: (v: number | "") => void;
  placeholder: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = options.filter(o => o.name.toLowerCase().includes(q.toLowerCase()));
  const selected = options.find(o => o.id === value);

  return (
    <div className="relative">
      <button type="button" onClick={() => { setOpen(!open); setQ(""); }}
        className={`w-full flex items-center justify-between border rounded-xl px-3 py-2.5 text-sm bg-card transition-colors text-left ${
          open ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/50"
        } ${!selected && required ? "border-destructive/50" : ""}`}>
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? selected.name : placeholder}
        </span>
        <svg className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-border">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск..."
              className="w-full px-2 py-1.5 text-sm bg-muted/30 rounded-lg focus:outline-none" />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {!required && (
              <button type="button" onClick={() => { onChange(""); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors">
                — Без выбора
              </button>
            )}
            {filtered.length === 0
              ? <p className="px-3 py-3 text-xs text-muted-foreground text-center">Не найдено</p>
              : filtered.map(o => (
                <button key={o.id} type="button" onClick={() => { onChange(o.id); setOpen(false); setQ(""); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${value === o.id ? "text-primary font-medium" : ""}`}>
                  {o.name}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Formula toolbar ────────────────────────────────────────────────────────────
const FORMULA_SNIPPETS = [
  { label: "a/b", insert: "\\frac{a}{b}" }, { label: "√", insert: "\\sqrt{x}" },
  { label: "xⁿ",  insert: "x^{n}" },        { label: "xₙ", insert: "x_{n}" },
  { label: "log", insert: "\\log_{2}(x)" },  { label: "∑",  insert: "\\sum_{i=1}^{n}" },
  { label: "∞",   insert: "\\infty" },        { label: "π",  insert: "\\pi" },
  { label: "≤",   insert: "\\leq" },          { label: "≥",  insert: "\\geq" },
  { label: "≠",   insert: "\\neq" },          { label: "±",  insert: "\\pm" },
];

function FormulaToolbar({ taRef, onChange }: {
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  onChange: (v: string) => void;
}) {
  function insert(snippet: string) {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const wrapped = s !== e ? `$${v.slice(s, e)}$` : `$${snippet}$`;
    const next = v.slice(0, s) + wrapped + v.slice(e);
    onChange(next);
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + wrapped.length; }, 0);
  }
  return (
    <div className="flex flex-wrap gap-1 p-2 bg-muted/20 border-b border-border">
      {FORMULA_SNIPPETS.map(s => (
        <button key={s.label} type="button" onClick={() => insert(s.insert)}
          className="px-2 py-0.5 text-xs border border-border rounded-md bg-card hover:bg-muted hover:border-primary/50 transition-colors font-mono">
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ── Image upload helper ────────────────────────────────────────────────────────
function ImageUploadField({ value, onChange, label = "Изображение", optional = true }: {
  value: string; onChange: (url: string) => void;
  label?: string; optional?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const src = value ? (value.startsWith("/static/") ? `${apiOrigin}${value}` : value) : "";

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/upload/image", fd);
      onChange(data.url);
    } finally { setUploading(false); e.target.value = ""; }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">
        {label} {optional && <span className="text-muted-foreground font-normal">(необязательно)</span>}
      </label>
      {src ? (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="max-h-36 rounded-xl border border-border object-contain" />
          <button type="button" onClick={() => onChange("")}
            className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-card/80 border border-border flex items-center justify-center text-xs hover:bg-destructive hover:text-white transition-colors">
            ✕
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} disabled={uploading}
          className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors w-fit disabled:opacity-50">
          {uploading
            ? <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeLinecap="round"/></svg>
            : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          }
          Загрузить изображение
        </button>
      )}
      <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={handle} />
    </div>
  );
}

// ── Answer options: single / multi ────────────────────────────────────────────
interface OptionDraft { text: string; is_correct: boolean }

function OptionsEditor({ options, onChange, multi }: {
  options: OptionDraft[]; onChange: (o: OptionDraft[]) => void; multi: boolean;
}) {
  function toggleCorrect(idx: number) {
    if (multi) {
      onChange(options.map((o, i) => i === idx ? { ...o, is_correct: !o.is_correct } : o));
    } else {
      onChange(options.map((o, i) => ({ ...o, is_correct: i === idx })));
    }
  }
  function setText(idx: number, text: string) {
    onChange(options.map((o, i) => i === idx ? { ...o, text } : o));
  }
  function remove(idx: number) {
    if (options.length <= 2) return;
    onChange(options.filter((_, i) => i !== idx));
  }

  const hasCorrect = options.some(o => o.is_correct);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">Варианты ответов</label>
        {!hasCorrect && <span className="text-xs text-destructive">Отметьте правильный</span>}
      </div>
      {options.map((opt, i) => (
        <div key={i} className={`flex items-center gap-2 border rounded-xl px-3 py-2 transition-colors ${
          opt.is_correct ? "border-green-500/50 bg-green-500/5" : "border-border bg-card"}`}>
          <button type="button" onClick={() => toggleCorrect(i)}
            className={`shrink-0 flex items-center justify-center transition-colors ${
              multi ? "w-5 h-5 rounded border-2" : "w-5 h-5 rounded-full border-2"
            } ${opt.is_correct ? "border-green-500 bg-green-500" : "border-muted-foreground hover:border-primary"}`}>
            {opt.is_correct && (
              <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M20 6 9 17l-5-5"/>
              </svg>
            )}
          </button>
          <input value={opt.text} onChange={e => setText(i, e.target.value)}
            placeholder={`Вариант ${i + 1}...`}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground" />
          <button type="button" onClick={() => remove(i)} disabled={options.length <= 2}
            className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 text-xs shrink-0">✕</button>
        </div>
      ))}
      {options.length < 6 && (
        <button type="button"
          onClick={() => onChange([...options, { text: "", is_correct: false }])}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-1">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
          Добавить вариант
        </button>
      )}
    </div>
  );
}

// ── Matching editor ────────────────────────────────────────────────────────────
interface MatchPair { text: string; match_text: string }

function MatchingEditor({ pairs, onChange }: {
  pairs: MatchPair[]; onChange: (p: MatchPair[]) => void;
}) {
  function update(idx: number, field: "text" | "match_text", val: string) {
    onChange(pairs.map((p, i) => i === idx ? { ...p, [field]: val } : p));
  }
  function remove(idx: number) {
    if (pairs.length <= 2) return;
    onChange(pairs.filter((_, i) => i !== idx));
  }

  const labels = "АБВГДЕЖЗИЙ";

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">Пары соответствий</label>
      <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-x-2 gap-y-2 items-center">
        <div className="text-xs text-muted-foreground px-1" />
        <div className="text-xs text-muted-foreground font-medium px-2">Левая часть</div>
        <div className="text-xs text-muted-foreground font-medium px-2">Правильное значение</div>
        <div />
        {pairs.map((pair, i) => (
          <React.Fragment key={i}>
            <span className="text-sm font-bold text-primary text-center w-6">{labels[i]}</span>
            <input value={pair.text} onChange={e => update(i, "text", e.target.value)}
              placeholder="Выражение..."
              className="border border-border rounded-xl px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
            <input value={pair.match_text} onChange={e => update(i, "match_text", e.target.value)}
              placeholder="Значение..."
              className="border border-border rounded-xl px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
            <button type="button" onClick={() => remove(i)} disabled={pairs.length <= 2}
              className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30 text-xs">✕</button>
          </React.Fragment>
        ))}
      </div>
      {pairs.length < 8 && (
        <button type="button"
          onClick={() => onChange([...pairs, { text: "", match_text: "" }])}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-1">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
          Добавить пару
        </button>
      )}
    </div>
  );
}

// ── Sub-question editor (for context type) ────────────────────────────────────
interface SubQuestionDraft {
  text: string;
  qtype: "single" | "multi";
  imageUrl: string;
  options: OptionDraft[];
}

function defaultSubQ(): SubQuestionDraft {
  return {
    text: "", qtype: "single", imageUrl: "",
    options: [
      { text: "", is_correct: false }, { text: "", is_correct: false },
      { text: "", is_correct: false }, { text: "", is_correct: false },
    ],
  };
}

function SubQuestionEditor({ sq, index, onChange, onRemove, canRemove }: {
  sq: SubQuestionDraft; index: number;
  onChange: (s: SubQuestionDraft) => void;
  onRemove: () => void; canRemove: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="border border-border rounded-xl bg-muted/10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border">
        <span className="text-sm font-semibold text-muted-foreground">Вопрос {index + 1}</span>
        <div className="flex items-center gap-2">
          {/* mini type selector */}
          {(["single", "multi"] as const).map(t => (
            <button key={t} type="button" onClick={() => onChange({ ...sq, qtype: t })}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                sq.qtype === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
              {t === "single" ? "◉ Один" : "☑ Несколько"}
            </button>
          ))}
          {canRemove && (
            <button type="button" onClick={onRemove}
              className="text-muted-foreground hover:text-destructive transition-colors text-xs ml-1">✕</button>
          )}
        </div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <div className="flex flex-col gap-0 border border-border rounded-xl overflow-hidden">
          <FormulaToolbar taRef={taRef} onChange={v => onChange({ ...sq, text: v })} />
          <textarea ref={taRef} rows={3} value={sq.text}
            onChange={e => onChange({ ...sq, text: e.target.value })}
            placeholder={`Текст вопроса ${index + 1}...`}
            className="w-full px-4 py-3 text-sm bg-card resize-none focus:outline-none" />
          {sq.text.includes("$") && (
            <div className="px-4 py-2 bg-muted/20 border-t border-border text-sm text-muted-foreground">
              <MathText text={sq.text} />
            </div>
          )}
        </div>
        <OptionsEditor
          options={sq.options}
          onChange={opts => onChange({ ...sq, options: opts })}
          multi={sq.qtype === "multi"}
        />
      </div>
    </div>
  );
}

// ── Compact image upload for import ───────────────────────────────────────────
function ImageUploadImport({ value, onChange }: { value: string; onChange: (u: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const src = value ? (value.startsWith("/static/") ? `${apiOrigin}${value}` : value) : "";

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/upload/image", fd);
      onChange(data.url);
    } finally { setUploading(false); e.target.value = ""; }
  }

  if (src) return (
    <div className="relative inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="max-h-28 rounded-lg border border-border object-contain" />
      <button type="button" onClick={() => onChange("")}
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-card/90 border border-border flex items-center justify-center text-xs hover:bg-destructive hover:text-white">✕</button>
    </div>
  );

  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} disabled={uploading}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors py-0.5 disabled:opacity-50">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        {uploading ? "Загрузка..." : "Изображение формулы"}
      </button>
      <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={handle} />
    </>
  );
}

// ── Import view ────────────────────────────────────────────────────────────────
interface IQ {
  num: number; text: string;
  options: { label: string; text: string }[];
  type: "single" | "multi" | "matching";
  contextId?: number;
  correctIndices: Set<number>;
  include: boolean;
  imageUrl: string;
}
interface IC { id: number; title: string; body: string; }

function ImportView({ topics, onBack, onSaved }: {
  topics: Topic[]; onBack: () => void; onSaved: () => void;
}) {
  const [parsed, setParsed] = useState<{ questions: IQ[]; contexts: IC[] } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [topicId, setTopicId] = useState<number|"">("");
  const [difficulty, setDifficulty] = useState<1|2|3>(1);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true); setParseError(""); setParsed(null);
    try {
      let text = "";
      const ext = file.name.split(".").pop()?.toLowerCase();

      if (ext === "pdf") {
        const { extractPDFText } = await import("@/utils/pdf-extract");
        text = await extractPDFText(file);
        const { data: parsed2 } = await api.post("/questions/parse-text", { text });
        const questions2: IQ[] = (parsed2.questions || []).map((q: { num: number; text: string; options: { label: string; text: string }[]; type: string; context_id?: number; image_url?: string }) => ({
          num: q.num, text: q.text, options: q.options || [],
          type: (q.type || "single") as "single"|"multi"|"matching",
          contextId: q.context_id, correctIndices: new Set<number>(), include: true,
          imageUrl: q.image_url || "",
        }));
        setParsed({ questions: questions2, contexts: parsed2.contexts || [] });
        return;
      } else if (ext === "docx") {
        // DOCX: send to backend which handles XML extraction + OMML→LaTeX + images
        const fd = new FormData(); fd.append("file", file);
        const { data: importData } = await api.post("/questions/import", fd);
        const questions3: IQ[] = (importData.questions || []).map((q: { num: number; text: string; options: { label: string; text: string }[]; type: string; context_id?: number; image_url?: string }) => ({
          num: q.num, text: q.text, options: q.options || [],
          type: (q.type || "single") as "single"|"multi"|"matching",
          contextId: q.context_id, correctIndices: new Set<number>(), include: true,
          imageUrl: q.image_url || "",
        }));
        setParsed({ questions: questions3, contexts: importData.contexts || [] });
        return;
      } else {
        text = await file.text();
      }

      const { data } = await api.post("/questions/parse-text", { text });
      const questions: IQ[] = (data.questions || []).map((q: { num: number; text: string; options: { label: string; text: string }[]; type: string; context_id?: number; image_url?: string }) => ({
        num: q.num, text: q.text, options: q.options || [],
        type: (q.type || "single") as "single"|"multi"|"matching",
        contextId: q.context_id, correctIndices: new Set<number>(), include: true,
        imageUrl: q.image_url || "",
      }));
      setParsed({ questions, contexts: data.contexts || [] });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setParseError(e.response?.data?.error || "Ошибка парсинга файла. Попробуйте TXT формат.");
    } finally { setParsing(false); }
  }

  function toggleCorrect(qi: number, oi: number) {
    if (!parsed) return;
    const q = parsed.questions[qi];
    const s = new Set(q.correctIndices);
    if (q.type === "single") { s.clear(); s.add(oi); }
    else { if (s.has(oi)) s.delete(oi); else s.add(oi); }
    const newQs = [...parsed.questions];
    newQs[qi] = { ...q, correctIndices: s };
    setParsed({ ...parsed, questions: newQs });
  }

  function toggleInclude(qi: number) {
    if (!parsed) return;
    const newQs = [...parsed.questions];
    newQs[qi] = { ...newQs[qi], include: !newQs[qi].include };
    setParsed({ ...parsed, questions: newQs });
  }

  async function handleSave() {
    if (!parsed || !topicId) return;
    setSaving(true); setSavedCount(0);
    const contextMap = new Map<number, IQ[]>();
    const regular: IQ[] = [];
    for (const q of parsed.questions) {
      if (!q.include) continue;
      if (q.contextId != null) {
        const arr = contextMap.get(q.contextId) || []; arr.push(q); contextMap.set(q.contextId, arr);
      } else { regular.push(q); }
    }
    for (const [ctxId, qs] of contextMap) {
      const ctx = parsed.contexts.find(c => c.id === ctxId);
      try {
        await api.post("/question-contexts", {
          title: ctx?.title || null, body: ctx?.body || "",
          topic_id: topicId,
          questions: qs.map(q => ({
            text: q.text, question_type: q.type, difficulty,
            options: q.options.map((o, i) => ({ text: o.text, is_correct: q.correctIndices.has(i) })),
          })),
        });
        setSavedCount(c => c + qs.length);
      } catch {}
    }
    for (const q of regular) {
      try {
        await api.post("/questions", {
          text: q.text, difficulty, question_type: q.type, topic_id: topicId,
          image_url: q.imageUrl || null,
          options: q.options.map((o, i) => ({ text: o.text, is_correct: q.correctIndices.has(i) })),
        });
        setSavedCount(c => c + 1);
      } catch {}
    }
    setSaving(false); onSaved();
  }

  const included = parsed?.questions.filter(q => q.include) ?? [];
  const withoutAnswer = included.filter(q => q.options.length > 0 && q.correctIndices.size === 0);
  const canSave = included.length > 0 && topicId !== "" && !saving;

  if (!parsed) {
    return (
      <div className="p-4 md:p-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <h1 className="text-2xl font-bold">Импорт вопросов</h1>
        </div>
        <div className={`border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-4 transition-colors ${parsing ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/50"}`}>
          {parsing ? (
            <>
              <svg className="w-10 h-10 text-primary animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeLinecap="round"/>
              </svg>
              <p className="text-sm text-muted-foreground">Парсинг файла...</p>
            </>
          ) : (
            <>
              <svg className="w-12 h-12 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
              <p className="text-base font-medium">Загрузите файл с вопросами</p>
              <p className="text-sm text-muted-foreground text-center">
                <b>DOCX</b> (Word) · PDF · TXT<br/>
                Вопросы начинаются с номера: «1.», «2.»<br/>
                Варианты ответов: «A)», «B)», «C)», «D)»
              </p>
              <p className="text-xs text-green-500/80 text-center">
                ✓ Word (.docx): формулы и изображения извлекаются автоматически
              </p>
              <Button onClick={() => fileRef.current?.click()} variant="outline">Выбрать файл</Button>
              {parseError && <p className="text-sm text-destructive">{parseError}</p>}
            </>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.txt,.docx" className="hidden" onChange={handleFile} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto pb-24">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold">Предпросмотр импорта</h1>
          <p className="text-xs text-muted-foreground">
            {parsed.questions.length} вопросов
            {parsed.contexts.length > 0 ? ` · ${parsed.contexts.length} контекст(а)` : ""}
          </p>
        </div>
        <Button disabled={!canSave} onClick={handleSave}>
          {saving ? `${savedCount} / ${included.length}` : `Сохранить ${included.length}`}
        </Button>
      </div>

      <div className="border border-border rounded-xl bg-card p-4 mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Тематика для всех <span className="text-destructive">*</span></label>
          <SearchSelect options={topics} value={topicId} onChange={setTopicId} placeholder="Выберите тему..." required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">Сложность</label>
          <div className="flex rounded-xl border border-border overflow-hidden">
            {([1,2,3] as const).map(d => (
              <button key={d} type="button" onClick={() => setDifficulty(d)}
                className={`flex-1 py-1.5 text-sm font-medium transition-colors ${difficulty === d ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                {DIFF[d].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {withoutAnswer.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl mb-4 text-xs text-yellow-600">
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          {withoutAnswer.length} вопросов без правильного ответа
        </div>
      )}

      {/* Info about formulas */}
      <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-500/10 border border-blue-500/30 rounded-xl mb-3 text-xs text-blue-400">
        <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        <span>Математические формулы в PDF хранятся как <b>изображения</b> и не извлекаются автоматически. Введите LaTeX вручную (например <code>$\sqrt{"{48}"}$</code>) или загрузите скриншот формулы.</span>
      </div>

      <div className="flex flex-col gap-3">
        {parsed.questions.map((q, qi) => {
          const isFirstInCtx = q.contextId != null &&
            parsed.questions.findIndex(x => x.contextId === q.contextId) === qi;
          const ctx = q.contextId != null ? parsed.contexts.find(c => c.id === q.contextId) : null;

          function updateQ(patch: Partial<IQ>) {
            const newQs = [...parsed!.questions];
            newQs[qi] = { ...q, ...patch };
            setParsed({ ...parsed!, questions: newQs });
          }
          function updateOption(oi: number, text: string) {
            const newOpts = q.options.map((o, i) => i === oi ? { ...o, text } : o);
            updateQ({ options: newOpts });
          }

          return (
            <React.Fragment key={qi}>
              {isFirstInCtx && ctx && (
                <div className="border border-violet-500/30 rounded-xl bg-violet-500/5 p-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-medium">📄 Контекст</span>
                    {ctx.title && <span className="text-sm font-semibold">{ctx.title}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{ctx.body}</p>
                </div>
              )}
              <div className={`border rounded-2xl bg-card overflow-hidden transition-opacity ${!q.include ? "opacity-40" : ""}`}
                style={{ borderColor: q.include && q.options.length > 0 && q.correctIndices.size === 0 ? "rgb(234 179 8 / 0.4)" : undefined }}>
                {/* Card header */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/10 border-b border-border">
                  <span className="text-xs text-muted-foreground font-mono">#{q.num}</span>
                  <div className="flex-1" />
                  <select value={q.type}
                    onChange={e => updateQ({ type: e.target.value as "single"|"multi"|"matching", correctIndices: new Set() })}
                    className="text-xs px-2 py-1 rounded-lg border border-border bg-card cursor-pointer focus:outline-none">
                    <option value="single">◉ Один</option>
                    <option value="multi">☑ Несколько</option>
                    <option value="matching">⇄ Соответствие</option>
                  </select>
                  <button type="button" onClick={() => toggleInclude(qi)}
                    title={q.include ? "Убрать" : "Включить"}
                    className="w-6 h-6 flex items-center justify-center text-xs text-muted-foreground hover:text-destructive transition-colors">
                    {q.include ? "✕" : "↩"}
                  </button>
                </div>

                <div className="p-4 flex flex-col gap-3">
                  {/* Editable question text */}
                  <div className="flex flex-col gap-0 border border-border rounded-xl overflow-hidden">
                    <div className="flex flex-wrap gap-1 p-1.5 bg-muted/20 border-b border-border">
                      {FORMULA_SNIPPETS.slice(0,6).map(s => (
                        <button key={s.label} type="button"
                          onClick={() => {
                            const cursor = q.text.length;
                            updateQ({ text: q.text + `$${s.insert}$` });
                            void cursor;
                          }}
                          className="px-1.5 py-0.5 text-xs border border-border rounded bg-card hover:bg-muted font-mono">
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <textarea rows={2} value={q.text} onChange={e => updateQ({ text: e.target.value })}
                      placeholder="Текст вопроса..."
                      className="w-full px-3 py-2 text-sm bg-card resize-none focus:outline-none" />
                    {q.text.includes("$") && (
                      <div className="px-3 py-1.5 bg-muted/20 border-t border-border text-xs text-muted-foreground">
                        <MathText text={q.text} />
                      </div>
                    )}
                  </div>

                  {/* Image upload for question */}
                  <ImageUploadImport
                    value={q.imageUrl}
                    onChange={url => updateQ({ imageUrl: url })}
                  />

                  {/* Options */}
                  {q.options.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Варианты — {q.type === "multi" ? "☑ несколько" : "◉ один"} правильный
                        </span>
                        {q.correctIndices.size === 0 && q.include && (
                          <span className="text-xs text-yellow-500">Отметьте правильный</span>
                        )}
                      </div>
                      {q.options.map((opt, oi) => {
                        const correct = q.correctIndices.has(oi);
                        return (
                          <div key={oi} className={`flex items-center gap-2 border rounded-xl px-2 py-1.5 transition-colors ${
                            correct ? "border-green-500/50 bg-green-500/5" : "border-border bg-muted/10"}`}>
                            {/* Correct marker */}
                            <button type="button" onClick={() => toggleCorrect(qi, oi)}
                              className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                correct ? "border-green-500 bg-green-500" : "border-muted-foreground hover:border-primary"}`}>
                              {correct && <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6 9 17l-5-5"/></svg>}
                            </button>
                            <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{opt.label})</span>
                            <input value={opt.text} onChange={e => updateOption(oi, e.target.value)}
                              placeholder={`Вариант ${opt.label} (или LaTeX: $формула$)...`}
                              className="flex-1 text-sm bg-transparent focus:outline-none placeholder:text-muted-foreground/50 min-w-0" />
                            {opt.text.includes("$") && (
                              <span className="text-xs text-muted-foreground shrink-0"><MathText text={opt.text} /></span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Добавьте варианты ответов</span>
                        <button type="button" onClick={() => updateQ({ options: [
                          { label: "A", text: "" }, { label: "B", text: "" },
                          { label: "C", text: "" }, { label: "D", text: "" },
                        ]})} className="text-xs text-primary hover:underline">+ A/B/C/D</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      <div className="fixed bottom-4 left-0 right-0 flex justify-center pointer-events-none">
        <div className="pointer-events-auto bg-card border border-border rounded-xl px-4 py-3 shadow-lg flex items-center gap-4">
          <span className="text-sm">
            <span className="font-medium">{included.length}</span>
            <span className="text-muted-foreground"> из {parsed.questions.length} вопросов</span>
          </span>
          <Button disabled={!canSave} onClick={handleSave} className="h-8">
            {saving ? `Сохраняю ${savedCount}...` : "Сохранить"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Question type icons ────────────────────────────────────────────────────────
const Q_TYPES = [
  { value: "single",   label: "Один ответ",  icon: "◉" },
  { value: "multi",    label: "Несколько",   icon: "☑" },
  { value: "matching", label: "Соответствие", icon: "⇄" },
  { value: "context",  label: "В контексте", icon: "📄" },
];

// ── Main page ──────────────────────────────────────────────────────────────────
const DEFAULT_OPTIONS: OptionDraft[] = [
  { text: "", is_correct: false }, { text: "", is_correct: false },
  { text: "", is_correct: false }, { text: "", is_correct: false },
];
const DEFAULT_PAIRS: MatchPair[] = [
  { text: "", match_text: "" }, { text: "", match_text: "" },
];

export default function QuestionBankPage() {
  const qc = useQueryClient();
  const [importMode, setImportMode] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Single/multi/matching state
  const [text, setText] = useState("");
  const [qtype, setQtype] = useState<"single"|"multi"|"matching"|"context">("single");
  const [difficulty, setDifficulty] = useState<1|2|3>(1);
  const [topicId, setTopicId] = useState<number|"">("");
  const [subtopicId, setSubtopicId] = useState<number|"">("");
  const [explanation, setExplanation] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [explanationImageUrl, setExplanationImageUrl] = useState("");
  const [options, setOptions] = useState<OptionDraft[]>(DEFAULT_OPTIONS);
  const [pairs, setPairs] = useState<MatchPair[]>(DEFAULT_PAIRS);

  // Context type state
  const ctxBodyRef = useRef<HTMLTextAreaElement>(null);
  const [ctxTitle, setCtxTitle] = useState("");
  const [ctxBody, setCtxBody] = useState("");
  const [ctxImage, setCtxImage] = useState("");
  const [subQuestions, setSubQuestions] = useState<SubQuestionDraft[]>([defaultSubQ()]);

  // List filters
  const [search, setSearch] = useState("");
  const [filterTopic, setFilterTopic] = useState<number|"">("");

  const { data: questions = [], isLoading } = useQuery<BankQuestion[]>({
    queryKey: ["my-questions"],
    queryFn: async () => (await api.get("/questions/mine")).data,
  });
  const { data: contexts = [], isLoading: ctxLoading } = useQuery<BankContext[]>({
    queryKey: ["my-contexts"],
    queryFn: async () => (await api.get("/question-contexts/mine")).data,
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
    setText(""); setQtype("single"); setDifficulty(1); setTopicId(""); setSubtopicId("");
    setExplanation(""); setImageUrl(""); setExplanationImageUrl("");
    setOptions(DEFAULT_OPTIONS); setPairs(DEFAULT_PAIRS); setEditId(null);
    setCtxTitle(""); setCtxBody(""); setCtxImage(""); setSubQuestions([defaultSubQ()]);
  }

  const validOptions = options.filter(o => o.text.trim());
  const hasCorrect = validOptions.some(o => o.is_correct);
  const validPairs = pairs.filter(p => p.text.trim() && p.match_text.trim());

  const ctxValid = qtype === "context" && ctxBody.trim() && topicId !== "" &&
    subQuestions.length >= 1 && subQuestions.every(sq =>
      sq.text.trim() &&
      sq.options.filter(o => o.text.trim()).length >= 2 &&
      sq.options.some(o => o.is_correct)
    );

  const canSubmit = qtype === "context" ? ctxValid : (
    text.trim() && topicId !== "" && (
      qtype === "matching" ? validPairs.length >= 2 : (hasCorrect && validOptions.length >= 2)
    )
  );

  const createQuestion = useMutation({
    mutationFn: () => api.post("/questions", {
      text, difficulty, question_type: qtype,
      topic_id: topicId || null, subtopic_id: subtopicId || null,
      explanation: explanation || null,
      explanation_image_url: explanationImageUrl || null,
      image_url: imageUrl || null,
      options: qtype === "matching"
        ? validPairs.map(p => ({ text: p.text, is_correct: false, match_text: p.match_text }))
        : validOptions,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-questions"] }); resetForm(); setShowForm(false); },
  });

  const createContext = useMutation({
    mutationFn: () => api.post("/question-contexts", {
      title: ctxTitle || null,
      body: ctxBody,
      image_url: ctxImage || null,
      topic_id: topicId || null,
      subtopic_id: subtopicId || null,
      questions: subQuestions.map(sq => ({
        text: sq.text,
        question_type: sq.qtype,
        difficulty: 1,
        image_url: sq.imageUrl || null,
        options: sq.options.filter(o => o.text.trim()),
      })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-contexts"] }); resetForm(); setShowForm(false); },
  });

  const updateQuestion = useMutation({
    mutationFn: (id: number) => api.put(`/questions/${id}`, {
      text, difficulty, question_type: qtype,
      topic_id: topicId || null, subtopic_id: subtopicId || null,
      explanation: explanation || null,
      explanation_image_url: explanationImageUrl || null,
      image_url: imageUrl || null,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-questions"] }); resetForm(); setShowForm(false); },
  });

  const deleteQuestion = useMutation({
    mutationFn: (id: number) => api.delete(`/questions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-questions"] }),
  });

  const deleteContext = useMutation({
    mutationFn: (id: number) => api.delete(`/question-contexts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-contexts"] }),
  });

  const displayed = questions.filter(q => {
    if (filterTopic && q.topic_id !== filterTopic) return false;
    if (search && !q.text.toLowerCase().includes(search.toLowerCase()) &&
        !q.topic_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const displayedCtx = contexts.filter(ctx => {
    if (filterTopic && ctx.topic_id !== filterTopic) return false;
    if (search && !ctx.body.toLowerCase().includes(search.toLowerCase()) &&
        !ctx.title?.toLowerCase().includes(search.toLowerCase()) &&
        !ctx.topic_name?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const TYPE_LABEL: Record<string, string> = { single: "Один ответ", multi: "Несколько ответов", matching: "Соответствие" };
  const TYPE_COLOR: Record<string, string> = { single: "bg-blue-500/10 text-blue-400", multi: "bg-purple-500/10 text-purple-400", matching: "bg-orange-500/10 text-orange-400" };

  const totalCount = questions.length + contexts.length;

  if (importMode) {
    return (
      <ImportView
        topics={topics}
        onBack={() => setImportMode(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["my-questions"] });
          qc.invalidateQueries({ queryKey: ["my-contexts"] });
          setImportMode(false);
        }}
      />
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Банк вопросов</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setShowForm(false); setImportMode(true); }}>
            <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Импорт
          </Button>
          <Button onClick={() => { resetForm(); setShowForm(!showForm); }} variant={showForm ? "outline" : "default"}>
            {showForm ? "Отмена" : "Новый вопрос"}
          </Button>
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="border border-border rounded-2xl bg-card mb-6 overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="font-semibold">{editId ? "Редактировать вопрос" : "Новый вопрос"}</h2>
          </div>
          <div className="p-5 flex flex-col gap-4">

            {/* Question type */}
            <div className="flex gap-2">
              {Q_TYPES.map(t => (
                <button key={t.value} type="button" onClick={() => setQtype(t.value as typeof qtype)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-sm font-medium transition-colors ${
                    qtype === t.value ? "border-primary bg-primary/5 text-primary" : "border-border bg-card hover:bg-muted text-muted-foreground"}`}>
                  <span>{t.icon}</span><span>{t.label}</span>
                </button>
              ))}
            </div>

            {/* ── CONTEXT FORM ── */}
            {qtype === "context" ? (
              <>
                {/* Context material */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">
                    Контекстный материал <span className="text-destructive">*</span>
                  </label>
                  <div className="flex flex-col gap-0 border border-border rounded-xl overflow-hidden">
                    <FormulaToolbar taRef={ctxBodyRef} onChange={setCtxBody} />
                    <textarea ref={ctxBodyRef} rows={5} value={ctxBody} onChange={e => setCtxBody(e.target.value)}
                      placeholder="Текст задания / условие / дополнительный материал..."
                      className="w-full px-4 py-3 text-sm bg-card resize-none focus:outline-none" />
                    {ctxBody.includes("$") && (
                      <div className="px-4 py-2 bg-muted/20 border-t border-border text-sm text-muted-foreground">
                        <MathText text={ctxBody} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">
                    Заголовок <span className="text-muted-foreground font-normal">(необязательно)</span>
                  </label>
                  <input value={ctxTitle} onChange={e => setCtxTitle(e.target.value)}
                    placeholder="Например: «Башня»"
                    className="border border-border rounded-xl px-3 py-2.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>

                <ImageUploadField value={ctxImage} onChange={setCtxImage} />

                {/* Topic shared for all sub-questions */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Тематика <span className="text-destructive">*</span></label>
                  <SearchSelect options={topics} value={topicId}
                    onChange={v => { setTopicId(v); setSubtopicId(""); }}
                    placeholder="Выберите тематику..." required />
                </div>
                {topicId !== "" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">
                      Подтематика <span className="text-muted-foreground font-normal">(необязательно)</span>
                    </label>
                    <SearchSelect options={subtopics} value={subtopicId} onChange={setSubtopicId}
                      placeholder="Выберите подтематику..." />
                  </div>
                )}

                {/* Sub-questions */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">
                      Вопросы <span className="text-xs text-muted-foreground">({subQuestions.length}/5)</span>
                    </label>
                  </div>
                  {subQuestions.map((sq, i) => (
                    <SubQuestionEditor key={i} sq={sq} index={i}
                      onChange={updated => setSubQuestions(prev => prev.map((s, j) => j === i ? updated : s))}
                      onRemove={() => setSubQuestions(prev => prev.filter((_, j) => j !== i))}
                      canRemove={subQuestions.length > 1} />
                  ))}
                  {subQuestions.length < 5 && (
                    <button type="button"
                      onClick={() => setSubQuestions(prev => [...prev, defaultSubQ()])}
                      className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors py-1 border border-dashed border-border rounded-xl px-4 justify-center">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
                      Добавить вопрос
                    </button>
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button className="flex-1" disabled={!ctxValid}
                    loading={createContext.isPending}
                    onClick={() => createContext.mutate()}>
                    Создать контекст
                  </Button>
                </div>
              </>
            ) : (
              /* ── REGULAR FORM (single / multi / matching) ── */
              <>
                {/* Question text + formula toolbar */}
                <div className="flex flex-col gap-0 border border-border rounded-xl overflow-hidden">
                  <FormulaToolbar taRef={taRef} onChange={setText} />
                  <textarea ref={taRef} rows={4} value={text} onChange={e => setText(e.target.value)}
                    placeholder="Текст вопроса..."
                    className="w-full px-4 py-3 text-sm bg-card resize-none focus:outline-none" />
                  {text.includes("$") && (
                    <div className="px-4 py-2 bg-muted/20 border-t border-border text-sm text-muted-foreground">
                      <MathText text={text} />
                    </div>
                  )}
                </div>

                <ImageUploadField value={imageUrl} onChange={setImageUrl} />

                {/* Topic */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Тематика <span className="text-destructive">*</span></label>
                  <SearchSelect options={topics} value={topicId}
                    onChange={v => { setTopicId(v); setSubtopicId(""); }}
                    placeholder="Выберите тематику..." required />
                </div>

                {topicId !== "" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">
                      Подтематика <span className="text-muted-foreground font-normal">(необязательно)</span>
                    </label>
                    <SearchSelect options={subtopics} value={subtopicId} onChange={setSubtopicId}
                      placeholder={subtopics.length ? "Выберите подтематику..." : "Нет подтематик"} />
                  </div>
                )}

                {/* Difficulty */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Сложность</label>
                  <div className="flex rounded-xl border border-border overflow-hidden">
                    {([1,2,3] as const).map(d => (
                      <button key={d} type="button" onClick={() => setDifficulty(d)}
                        className={`flex-1 py-2 text-sm font-medium transition-colors ${difficulty === d ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                        {DIFF[d].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Answers */}
                {qtype === "matching"
                  ? <MatchingEditor pairs={pairs} onChange={setPairs} />
                  : <OptionsEditor options={options} onChange={setOptions} multi={qtype === "multi"} />
                }

                {/* Explanation */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">
                    Пояснение <span className="text-muted-foreground font-normal">(необязательно)</span>
                  </label>
                  <textarea rows={2} value={explanation} onChange={e => setExplanation(e.target.value)}
                    placeholder="Объяснение правильного ответа..."
                    className="border border-border rounded-xl px-3 py-2.5 text-sm bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary" />
                  <ImageUploadField value={explanationImageUrl} onChange={setExplanationImageUrl}
                    label="Изображение к пояснению" />
                </div>

                <div className="flex gap-2 pt-1">
                  <Button className="flex-1" disabled={!canSubmit}
                    loading={createQuestion.isPending || updateQuestion.isPending}
                    onClick={() => editId ? updateQuestion.mutate(editId) : createQuestion.mutate()}>
                    {editId ? "Сохранить" : "Создать вопрос"}
                  </Button>
                  {editId && <Button variant="outline" onClick={() => { resetForm(); setShowForm(false); }}>Отмена</Button>}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Search + filter */}
      {totalCount > 0 && (
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по тексту..."
              className="w-full border border-border rounded-xl pl-9 pr-4 py-2 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
          </div>
          <div className="w-44">
            <SearchSelect
              options={topics.filter(t =>
                questions.some(q => q.topic_id === t.id) ||
                contexts.some(c => c.topic_id === t.id)
              )}
              value={filterTopic} onChange={setFilterTopic} placeholder="Все темы" />
          </div>
        </div>
      )}

      {/* Context blocks */}
      {(ctxLoading || displayedCtx.length > 0) && (
        <div className="flex flex-col gap-3 mb-3">
          {ctxLoading && [1,2].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}
          {displayedCtx.map(ctx => (
            <div key={ctx.id} className="border border-border rounded-2xl bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 font-medium">
                      📄 В контексте
                    </span>
                    <span className="text-xs text-muted-foreground">{ctx.question_count} вопр.</span>
                    {ctx.topic_name && <span className="text-xs text-muted-foreground">· {ctx.topic_name}</span>}
                    {ctx.subtopic_name && <span className="text-xs text-muted-foreground">· {ctx.subtopic_name}</span>}
                  </div>
                  {ctx.title && (
                    <p className="text-sm font-semibold mb-0.5">{ctx.title}</p>
                  )}
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    <MathText text={ctx.body} />
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive shrink-0"
                  onClick={() => deleteContext.mutate(ctx.id)}>✕</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Individual questions */}
      {isLoading ? (
        <div className="flex flex-col gap-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-muted/30 rounded-xl animate-pulse" />)}</div>
      ) : displayed.length === 0 && displayedCtx.length === 0 && !ctxLoading ? (
        <div className="text-center py-12 text-muted-foreground">{totalCount === 0 ? "Нет вопросов в банке" : "Ничего не найдено"}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {displayed.map(q => (
            <div key={q.id} className="border border-border rounded-2xl bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug"><MathText text={q.text} /></p>
                  {q.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={q.image_url.startsWith("/static/") ? `${apiOrigin}${q.image_url}` : q.image_url}
                      alt="" className="mt-2 max-h-24 rounded-lg border border-border object-contain" />
                  )}
                  <div className="flex gap-2 mt-1.5 flex-wrap items-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${DIFF[q.difficulty]?.color ?? ""}`}>
                      {DIFF[q.difficulty]?.label}
                    </span>
                    {q.question_type && q.question_type !== "single" && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLOR[q.question_type] ?? ""}`}>
                        {TYPE_LABEL[q.question_type]}
                      </span>
                    )}
                    {q.topic_name && <span className="text-xs text-muted-foreground">{q.topic_name}</span>}
                    {q.subtopic_name && <span className="text-xs text-muted-foreground">· {q.subtopic_name}</span>}
                  </div>
                  {q.explanation && <p className="text-xs text-muted-foreground italic mt-1.5">💡 {q.explanation}</p>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => {
                    setEditId(q.id); setText(q.text);
                    setQtype((q.question_type as "single"|"multi"|"matching") || "single");
                    setDifficulty((q.difficulty as 1|2|3) || 1);
                    setTopicId(q.topic_id ?? ""); setSubtopicId(q.subtopic_id ?? "");
                    setExplanation(q.explanation ?? ""); setImageUrl(q.image_url ?? "");
                    setExplanationImageUrl(q.explanation_image_url ?? "");
                    setOptions(DEFAULT_OPTIONS); setPairs(DEFAULT_PAIRS);
                    setShowForm(true); window.scrollTo({ top: 0, behavior: "smooth" });
                  }}>✏️</Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                    onClick={() => deleteQuestion.mutate(q.id)}>✕</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
