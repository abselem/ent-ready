"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useParams, useSearchParams, usePathname } from "next/navigation";
import { api, apiOrigin } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Lesson { id: number; title: string; is_published: boolean; visibility: string; view_count: number; topic_id: number | null; subtopic_id: number | null }
interface Block { id: number; type: string; content: string; language: string; caption: string; order_num: number }
interface Topic { id: number; name: string }
type Content = Pick<Block, "content" | "language" | "caption">;
type Draft = { data: Content; revision: number; savedRevision: number; status: "dirty" | "saving" | "saved" | "error"; running?: Promise<boolean> };
const BLOCK_TYPES = [
  { value: "text", label: "Текст", icon: "¶", description: "Теория и объяснения" },
  { value: "image", label: "Изображение", icon: "▧", description: "Иллюстрация с подписью" },
  { value: "code", label: "Код", icon: "</>", description: "Пример программы" },
  { value: "note", label: "Заметка", icon: "i", description: "Важная мысль или подсказка" },
];
const blockType = (block: Block) => BLOCK_TYPES.find(type => type.value === block.type)?.label ?? block.type;

export default function TeacherLessonEditor() {
  return <Suspense fallback={<div className="page-shell" role="status">Открываем редактор…</div>}><LessonEditorRoute /></Suspense>;
}

function LessonEditorRoute() {
  const { id } = useParams();
  return <LessonEditor key={String(id)} lessonId={Number(id)} />;
}

function LessonEditor({ lessonId }: { lessonId: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const requestedStep = Number(searchParams.get("step"));
  const selectedId = Number.isInteger(requestedStep) && requestedStep > 0 ? requestedStep : null;
  function setSelectedId(stepId: number | null) {
    const query = new URLSearchParams(searchParams.toString());
    if (stepId !== null) query.set("step", String(stepId)); else query.delete("step");
    router.replace(query.size ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [showAccessPanel, setShowAccessPanel] = useState(false);
  const [showTopicPanel, setShowTopicPanel] = useState(false);
  const [topicDraft, setTopicDraft] = useState<number | "" | null>(null);
  const [subtopicDraft, setSubtopicDraft] = useState<number | "" | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const drafts = useRef(new Map<number, Draft>());
  const [draftSnapshot, setDraftSnapshot] = useState(new Map<number, Draft>());
  const redraw = () => setDraftSnapshot(new Map([...drafts.current].map(([key,draft]) => [key, { ...draft, data: { ...draft.data } }])));
  const validId = Number.isInteger(lessonId) && lessonId > 0;
  const lessonQuery = useQuery<Lesson>({ queryKey: ["lesson", lessonId], queryFn: async () => (await api.get(`/lessons/${lessonId}`)).data, enabled: validId });
  const blocksQuery = useQuery<Block[]>({ queryKey: ["lesson-blocks", lessonId], queryFn: async () => (await api.get(`/lessons/${lessonId}/blocks`)).data ?? [], enabled: validId });
  const lesson = lessonQuery.data;
  const blocks = [...(blocksQuery.data ?? [])].sort((a,b) => a.order_num - b.order_num || a.id - b.id);
  const selected = blocks.find(block => block.id === selectedId) ?? blocks[0];
  const selectedIndex = selected ? blocks.findIndex(block => block.id === selected.id) : -1;
  const hasDirty = [...draftSnapshot.values()].some(draft => draft.revision !== draft.savedRevision);
  const hasSaving = [...draftSnapshot.values()].some(draft => draft.status === "saving");
  const hasError = [...draftSnapshot.values()].some(draft => draft.status === "error");
  const topicId = topicDraft ?? lesson?.topic_id ?? "";
  const subtopicId = subtopicDraft ?? lesson?.subtopic_id ?? "";
  const { data: topics = [] } = useQuery<Topic[]>({ queryKey: ["topics"], queryFn: async () => (await api.get("/topics")).data ?? [] });
  const { data: subtopics = [] } = useQuery<Topic[]>({ queryKey: ["subtopics", topicId], queryFn: async () => (await api.get(`/topics/${topicId}/subtopics`)).data ?? [], enabled: !!topicId });

  useEffect(() => {
    if (!hasDirty && !uploading) return;
    document.body.dataset.unsavedLesson = "true";
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { delete document.body.dataset.unsavedLesson; window.removeEventListener("beforeunload", warn); };
  }, [hasDirty, uploading]);

  function contentFor(block: Block): Content { return draftSnapshot.get(block.id)?.data ?? { content: block.content, language: block.language, caption: block.caption }; }
  function changeBlock(block: Block, patch: Partial<Content>) {
    let draft = drafts.current.get(block.id);
    if (!draft) { draft = { data: { content: block.content, language: block.language, caption: block.caption }, revision: 0, savedRevision: 0, status: "saved" }; drafts.current.set(block.id, draft); }
    draft.data = { ...draft.data, ...patch }; draft.revision++; draft.status = draft.running ? "saving" : "dirty";
    setActionError(""); redraw();
  }
  function saveBlock(blockId: number): Promise<boolean> {
    const draft = drafts.current.get(blockId);
    if (!draft) return Promise.resolve(true);
    if (draft.running) return draft.running;
    if (draft.savedRevision === draft.revision) return Promise.resolve(true);
    draft.status = "saving"; redraw();
    draft.running = Promise.resolve().then(async () => {
      while (draft.savedRevision !== draft.revision) {
        const revision = draft.revision, data = { ...draft.data };
        try {
          const response = await api.put(`/lesson-blocks/${blockId}`, data);
          draft.savedRevision = revision;
          qc.setQueryData<Block[]>(["lesson-blocks", lessonId], previous => previous?.map(block => block.id === blockId ? { ...block, ...data, ...response.data } : block));
        } catch { draft.status = "error"; redraw(); return false; }
      }
      draft.status = "saved"; redraw(); return true;
    }).finally(() => { draft.running = undefined; });
    return draft.running;
  }
  async function afterSaving(action?: () => void | Promise<unknown>) {
    if (busy || uploading) return;
    setBusy(true); setActionError("");
    try {
      for (const block of blocks) {
        if (!(await saveBlock(block.id))) { setSelectedId(block.id); setActionError(`Не удалось сохранить шаг ${blocks.findIndex(item => item.id === block.id) + 1}. Черновик остаётся в редакторе.`); return; }
      }
      await action?.();
    } catch { setActionError("Не удалось выполнить действие. Изменения остаются в редакторе. Повторите попытку."); }
    finally { setBusy(false); }
  }
  const createBlock = useMutation({
    mutationFn: (type: string) => api.post(`/lessons/${lessonId}/blocks`, { type, content: "", language: "", caption: "" }),
    onSuccess: ({ data }) => { qc.setQueryData<Block[]>(["lesson-blocks", lessonId], previous => [...(previous ?? []), data]); setSelectedId(data.id); setShowTypeMenu(false); setShowSteps(false); },
    onError: () => setActionError("Не удалось добавить шаг. Повторите попытку."),
  });
  const reorder = useMutation({
    mutationFn: (next: Block[]) => api.post(`/lessons/${lessonId}/blocks/reorder`, { order: next.map((block,index) => ({ id: block.id, order_num: index })) }),
    onSuccess: (_, next) => qc.setQueryData(["lesson-blocks", lessonId], next.map((block,index) => ({ ...block, order_num: index }))),
    onError: () => setActionError("Порядок шагов не изменён. Не удалось сохранить перестановку; повторите действие."),
  });
  const remove = useMutation({
    mutationFn: (blockId: number) => api.delete(`/lesson-blocks/${blockId}`),
    onSuccess: (_, blockId) => {
      const position = blocks.findIndex(block => block.id === blockId), next = blocks.filter(block => block.id !== blockId);
      drafts.current.delete(blockId); qc.setQueryData(["lesson-blocks", lessonId], next);
      setSelectedId(next[Math.min(position, next.length - 1)]?.id ?? null); redraw();
    },
    onError: () => setActionError("Не удалось удалить шаг. Содержимое сохранено в редакторе."),
  });
  const updateTopics = useMutation({ mutationFn: () => api.put(`/lessons/${lessonId}/topics`, { topic_id: topicId || null, subtopic_id: subtopicId || null }), onSuccess: () => { void lessonQuery.refetch(); setShowTopicPanel(false); }, onError: () => setActionError("Не удалось сохранить тему урока.") });
  const locked = busy || uploading || createBlock.isPending || reorder.isPending || remove.isPending;
  function move(direction: -1 | 1) {
    if (!selected || locked || hasSaving) return;
    const next = [...blocks], destination = selectedIndex + direction;
    if (destination < 0 || destination >= next.length) return;
    [next[selectedIndex], next[destination]] = [next[destination], next[selectedIndex]];
    reorder.mutate(next);
  }
  async function uploadImage(file: File, block: Block) {
    setUploading(true); setActionError("");
    try {
      const form = new FormData(); form.append("file", file);
      const { data } = await api.post("/upload/image", form);
      changeBlock(block, { content: `${apiOrigin}${data.url}` });
      if (!(await saveBlock(block.id))) setActionError("Изображение загружено, но шаг не сохранён. Повторите сохранение.");
    } catch { setActionError("Не удалось загрузить изображение. Повторите попытку."); }
    finally { setUploading(false); }
  }
  if (!validId || lessonQuery.isError) return <div className="page-shell"><p role="alert">Урок недоступен.</p><Button onClick={() => void lessonQuery.refetch()}>Повторить</Button></div>;
  if (lessonQuery.isPending) return <div className="page-shell" role="status">Загружаем урок…</div>;
  if (!lesson) return null;
  const draftStatus = hasError ? "Не удалось сохранить" : hasSaving || busy ? "Сохранение…" : hasDirty ? "Есть несохранённые изменения" : "Все изменения сохранены";
  return <div className="page-shell max-w-7xl">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><button className="mb-2 min-h-11 text-sm text-muted-foreground" onClick={() => { if ((!hasDirty && !uploading) || window.confirm("Выйти из редактора? Несохранённые изменения будут потеряны.")) router.push("/teacher/lessons"); }}>← К урокам</button><h1 className="break-words text-2xl font-semibold">{lesson.title}</h1><div className="mt-2 flex flex-wrap gap-3 text-sm"><span className="text-muted-foreground">{lesson.is_published ? "Опубликован" : "Закрытый черновик"}</span><span role="status" className={hasError ? "text-destructive" : "text-muted-foreground"}>{draftStatus}</span></div></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={locked || !hasDirty} onClick={() => void afterSaving()}>Сохранить всё</Button><Button variant="outline" disabled={locked || blocksQuery.isPending || blocksQuery.isError} onClick={() => void afterSaving(() => router.push(`/teacher/lessons/${lessonId}/preview${selected ? `?step=${selected.id}` : ""}`))}>Предпросмотр</Button><Button disabled={locked || blocksQuery.isPending || blocksQuery.isError} onClick={() => setShowAccessPanel(value => !value)}>{lesson.is_published ? "Настройки публикации" : "Опубликовать"}</Button></div>
    </header>
    {lesson.is_published && <p className="mb-4 rounded-xl border border-border bg-muted p-4 text-sm">Урок опубликован. Сохранённые правки сразу видны ученикам. Чтобы работать над закрытым материалом, снимите урок с публикации.</p>}
    {actionError && <p role="alert" className="mb-4 rounded-xl bg-destructive-surface p-4 text-sm text-destructive">{actionError}</p>}
    <div className="mb-5 flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={locked} onClick={() => setShowTopicPanel(value => !value)}>Предмет и подтема</Button><Button size="sm" variant="ghost" disabled={locked} onClick={() => void afterSaving(() => router.push(`/teacher/lessons/${lessonId}/viewers`))}>Просмотры урока</Button></div>
    {showTopicPanel && <section className="surface mb-5 space-y-4 p-5"><h2 className="font-semibold">Предмет и подтема</h2><label className="block text-sm">Предмет<select className="control-field mt-2" value={topicId} onChange={event => { setTopicDraft(event.target.value ? Number(event.target.value) : ""); setSubtopicDraft(""); }}><option value="">Не выбран</option>{topics.map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label><label className="block text-sm">Подтема<select className="control-field mt-2" disabled={!topicId} value={subtopicId} onChange={event => setSubtopicDraft(event.target.value ? Number(event.target.value) : "")}><option value="">Не выбрана</option>{subtopics.map(topic => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></label><Button size="sm" loading={updateTopics.isPending} onClick={() => updateTopics.mutate()}>Сохранить настройки</Button></section>}
    {showAccessPanel && <section className="surface mb-5 p-5"><h2 className="mb-3 font-semibold">Публикация урока</h2><p className="mb-4 text-sm text-muted-foreground">Перед публикацией сохраним все изменения шагов.</p><div className="grid gap-2 sm:grid-cols-2">{[{value:"all",label:"Для всех",desc:"Все пользователи"},{value:"school",label:"Школа",desc:"Мои школьные группы"},{value:"course",label:"Курс",desc:"Мои группы курсов"},{value:"private",label:"Приватный",desc:"Только предоставленный доступ"}].map(option => <Button key={option.value} variant="outline" disabled={locked || blocksQuery.isPending || blocksQuery.isError} className="h-auto min-h-16 flex-col items-start" onClick={() => void afterSaving(async () => { await api.post(`/lessons/${lessonId}/publish`,{visibility:option.value}); await lessonQuery.refetch(); setShowAccessPanel(false); })}><span>{option.label}</span><span className="text-xs font-normal text-muted-foreground">{option.desc}</span></Button>)}</div>{lesson.is_published && <Button variant="destructive" className="mt-4" disabled={locked} onClick={() => void afterSaving(async () => { await api.post(`/lessons/${lessonId}/unpublish`); await lessonQuery.refetch(); setShowAccessPanel(false); })}>Снять с публикации</Button>}</section>}
    {lesson.is_published && lesson.visibility === "private" && <AccessPanel lessonId={lessonId} />}
    {blocksQuery.isError ? <section className="surface p-6" role="alert"><p>Не удалось загрузить шаги урока.</p><Button variant="outline" onClick={() => void blocksQuery.refetch()}>Повторить</Button></section> : blocksQuery.isPending ? <section className="surface p-6" role="status">Загружаем шаги…</section> : <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="surface min-w-0 p-3"><button className="flex min-h-11 w-full items-center justify-between px-2 text-left font-semibold lg:pointer-events-none" onClick={() => setShowSteps(value => !value)} aria-expanded={showSteps}><span>Шаги урока · {blocks.length}</span><span className="lg:hidden">{showSteps ? "−" : "+"}</span></button><nav aria-label="Шаги урока" className={`${showSteps ? "block" : "hidden"} mt-2 space-y-1 lg:block`}>{blocks.map((block,index) => { const draft = draftSnapshot.get(block.id), data = contentFor(block); return <button key={block.id} disabled={locked} aria-current={selected?.id === block.id ? "step" : undefined} className={`flex min-h-16 w-full gap-3 rounded-xl p-3 text-left ${selected?.id === block.id ? "bg-accent text-primary" : "hover:bg-muted"}`} onClick={() => { setSelectedId(block.id); setShowSteps(false); }}><span className="shrink-0 text-sm font-semibold">{index+1}</span><span className="min-w-0"><span className="block text-sm font-medium">{blockType(block)}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{(block.type === "image" ? data.caption : data.content).split("\n")[0] || "Пустой шаг"}</span>{draft && draft.status !== "saved" && <span className={`mt-1 block text-xs ${draft.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{draft.status === "saving" ? "Сохранение…" : draft.status === "error" ? "Ошибка сохранения" : "Не сохранено"}</span>}</span></button>; })}</nav><Button variant="outline" className="mt-3 w-full" disabled={locked || hasSaving} aria-expanded={showTypeMenu} onClick={() => setShowTypeMenu(value => !value)}>+ Добавить шаг</Button>{showTypeMenu && <div className="mt-2 space-y-1" aria-label="Тип нового шага">{BLOCK_TYPES.map(type => <button key={type.value} disabled={locked} className="flex min-h-14 w-full gap-3 rounded-lg p-3 text-left hover:bg-muted" onClick={() => createBlock.mutate(type.value)}><span aria-hidden="true">{type.icon}</span><span><span className="block text-sm font-medium">{type.label}</span><span className="text-xs text-muted-foreground">{type.description}</span></span></button>)}</div>}</aside>
      <section className="min-w-0">{selected ? <div className="surface overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4"><h2 className="font-semibold">Шаг {selectedIndex+1}. {blockType(selected)}</h2><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={locked || hasSaving || selectedIndex === 0} onClick={() => move(-1)}>↑ Выше</Button><Button size="sm" variant="ghost" disabled={locked || hasSaving || selectedIndex === blocks.length-1} onClick={() => move(1)}>↓ Ниже</Button><Button size="sm" variant="destructive" disabled={locked || hasSaving} onClick={() => { if (window.confirm(`Удалить шаг ${selectedIndex+1}? Его содержимое будет удалено.`)) remove.mutate(selected.id); }}>Удалить</Button></div></div><StepEditor key={selected.id} block={selected} value={contentFor(selected)} disabled={locked} uploading={uploading} status={draftSnapshot.get(selected.id)?.status ?? "saved"} onChange={patch => changeBlock(selected,patch)} onSave={() => saveBlock(selected.id)} onUpload={file => uploadImage(file,selected)} /><div className="flex flex-wrap justify-between gap-2 border-t border-border p-4"><Button variant="outline" disabled={locked || selectedIndex===0} onClick={() => setSelectedId(blocks[selectedIndex-1].id)}>← Предыдущий шаг</Button><Button variant="outline" disabled={locked || selectedIndex===blocks.length-1} onClick={() => setSelectedId(blocks[selectedIndex+1].id)}>Следующий шаг →</Button></div></div> : <div className="surface p-8 text-center"><h2 className="text-lg font-semibold">Начните с первого шага</h2><p className="mt-2 text-sm text-muted-foreground">Разделите урок на небольшие части: объяснение, пример или иллюстрацию.</p><Button className="mt-5" onClick={() => setShowTypeMenu(true)}>Добавить первый шаг</Button></div>}</section>
    </div>}
  </div>;
}

function StepEditor({ block, value, disabled, uploading, status, onChange, onSave, onUpload }: { block: Block; value: Content; disabled: boolean; uploading: boolean; status: Draft["status"]; onChange: (patch: Partial<Content>) => void; onSave: () => Promise<boolean>; onUpload: (file: File) => Promise<void> }) {
  return <div className="space-y-4 p-5"><fieldset disabled={disabled} className="space-y-4"><legend className="sr-only">Содержимое шага</legend>{block.type === "image" ? <>
    <label className="block text-sm font-medium">Ссылка на изображение<input type="url" className="control-field mt-2" value={value.content} onChange={event => onChange({ content:event.target.value })} onBlur={() => void onSave()} placeholder="https://…" /></label>
    <label className="block text-sm font-medium">Загрузить изображение<input type="file" className="mt-2 block w-full text-sm" accept=".jpg,.jpeg,.png,.gif,.webp" onChange={event => { const file=event.target.files?.[0]; event.target.value=""; if(file) void onUpload(file); }} /></label>
    <label className="block text-sm font-medium">Подпись<input className="control-field mt-2" value={value.caption} onChange={event => onChange({caption:event.target.value})} onBlur={() => void onSave()} /></label>
    {value.content && <div className="rounded-xl border border-border p-3">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={value.content.startsWith("/static/") ? `${apiOrigin}${value.content}` : value.content} alt={value.caption || "Изображение шага"} className="max-h-96 max-w-full rounded-lg object-contain" /></div>}
  </> : <>
    {block.type === "code" && <label className="block text-sm font-medium">Язык программирования<input className="control-field mt-2" value={value.language} onChange={event => onChange({language:event.target.value})} onBlur={() => void onSave()} placeholder="python, javascript…" /></label>}
    <label className="block text-sm font-medium">{block.type === "code" ? "Код" : block.type === "note" ? "Текст заметки" : "Текст шага"}<textarea className={`control-field mt-2 min-h-64 resize-y leading-relaxed ${block.type === "code" ? "font-mono" : ""}`} rows={12} value={value.content} onChange={event => onChange({content:event.target.value})} onBlur={() => void onSave()} placeholder="Добавьте содержимое шага…" /></label>
    {block.type === "text" && <p className="text-xs text-muted-foreground">Разделяйте абзацы пустой строкой. Шаги помогают проходить материал небольшими частями.</p>}
  </>}</fieldset><div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className={`text-sm ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{uploading ? "Загружаем изображение…" : status === "dirty" ? "Есть несохранённые изменения" : status === "saving" ? "Сохранение…" : status === "error" ? "Не удалось сохранить. Черновик остаётся в редакторе." : "Шаг сохранён"}</p><Button variant="outline" disabled={disabled || status === "saved"} loading={status === "saving"} onClick={() => void onSave()}>{status === "error" ? "Повторить сохранение" : "Сохранить шаг"}</Button></div></div>;
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
    queryFn: async () => (await api.get(`/lessons/${lessonId}/access`)).data ?? [],
  });
  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data ?? [],
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
      <div className="flex flex-wrap gap-2 mb-3">
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
