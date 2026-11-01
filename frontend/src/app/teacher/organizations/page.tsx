"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useAuthStore } from "@/store/auth";
import { organizationApi, type Organization, type OrganizationRole, type OrganizationSettings } from "@/lib/organizations-api";
import { AsyncState } from "@/components/ui/async-state";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const roleLabel: Record<OrganizationRole, string> = { owner: "Владелец", admin: "Администратор", teacher: "Преподаватель", student: "Ученик", parent: "Родитель" };
const gradingLabel = { points: "Баллы", "5": "5-балльная", "10": "10-балльная", "100": "100-балльная" };
const defaults: OrganizationSettings = { name: "", timezone: "Asia/Qyzylorda", locale: "ru", grading_scale: "points" };
type Scope = readonly ["organizations", number, number];
type FieldErrors = Partial<Record<keyof OrganizationSettings, string>>;

function statusOf(error: unknown) { return isAxiosError(error) ? error.response?.status : undefined; }
function uncertain(error: unknown) { return isAxiosError(error) && !error.response; }
function validation(settings: OrganizationSettings): FieldErrors {
  const errors: FieldErrors = {};
  if (!settings.name.trim()) errors.name = "Введите название рабочего пространства";
  else if (Array.from(settings.name.trim()).length > 120) errors.name = "Название должно содержать не более 120 символов";
  if (!settings.timezone.trim()) errors.timezone = "Укажите часовой пояс IANA";
  return errors;
}
function focusError(prefix: string, errors: FieldErrors) {
  const field = Object.keys(errors)[0] ?? "name";
  document.getElementById(`${prefix}-${field}`)?.focus();
}
function serverFieldErrors(error: unknown): FieldErrors {
  if (statusOf(error) !== 400 || !isAxiosError<{ error?: string }>(error)) return {};
  const message = error.response?.data?.error ?? "";
  if (/timezone|time zone/i.test(message)) return { timezone: "Укажите существующий часовой пояс IANA, например Asia/Qyzylorda" };
  if (/name/i.test(message)) return { name: "Проверьте название: от 1 до 120 символов" };
  return {};
}
function toSettings(organization: Organization): OrganizationSettings {
  return { name: organization.name, timezone: organization.timezone, locale: organization.locale, grading_scale: organization.grading_scale };
}

function SettingsFields({ prefix, value, onChange, disabled, errors, nameRef }: {
  prefix: string; value: OrganizationSettings; onChange: (value: OrganizationSettings) => void;
  disabled: boolean; errors: FieldErrors; nameRef: React.Ref<HTMLInputElement>;
}) {
  return <div className="grid gap-4 md:grid-cols-2">
    <Input ref={nameRef} id={`${prefix}-name`} label="Название" value={value.name} maxLength={240} required
      disabled={disabled} error={errors.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
    <div>
      <Input id={`${prefix}-timezone`} label="Часовой пояс" value={value.timezone} required
        disabled={disabled} error={errors.timezone} aria-describedby={`${prefix}-timezone-help`}
        onChange={(e) => onChange({ ...value, timezone: e.target.value })} />
      <p id={`${prefix}-timezone-help`} className="mt-1.5 text-xs text-muted-foreground">Формат IANA, например Asia/Qyzylorda</p>
    </div>
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${prefix}-locale`} className="text-sm font-medium">Язык рабочего пространства</label>
      <select id={`${prefix}-locale`} className="control-field" value={value.locale} disabled={disabled}
        aria-describedby={`${prefix}-locale-help`} onChange={(e) => onChange({ ...value, locale: e.target.value as OrganizationSettings["locale"] })}>
        <option value="ru">Русский</option><option value="kk">Қазақша</option>
      </select>
      <p id={`${prefix}-locale-help`} className="text-xs text-muted-foreground">Язык рабочего пространства не меняет язык текущего интерфейса.</p>
    </div>
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${prefix}-grading`} className="text-sm font-medium">Система оценивания</label>
      <select id={`${prefix}-grading`} className="control-field" value={value.grading_scale} disabled={disabled}
        aria-describedby={`${prefix}-grading-help`} onChange={(e) => onChange({ ...value, grading_scale: e.target.value as OrganizationSettings["grading_scale"] })}>
        {Object.entries(gradingLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      <p id={`${prefix}-grading-help`} className="text-xs text-muted-foreground">Существующие результаты личного кабинета не пересчитываются.</p>
    </div>
  </div>;
}

function OrganizationEditor({ organization, scope, onDirtyChange }: { organization: Organization; scope: Scope; onDirtyChange: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => toSettings(organization));
  const [baseline, setBaseline] = useState(() => toSettings(organization));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [denied, setDenied] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const editable = ["owner", "admin"].includes(organization.role) && !denied;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const save = useMutation({
    mutationFn: (settings: OrganizationSettings) => organizationApi.update(organization.id, settings), retry: false,
    onSuccess: (saved) => {
      const settings = toSettings(saved);
      setDraft(settings); setBaseline(settings); setMessage("Настройки сохранены"); setSaveError("");
      queryClient.setQueryData([...scope, "detail", organization.id], saved);
      void queryClient.invalidateQueries({ queryKey: [...scope, "list"] });
    },
    onError: (error) => {
      const fields = serverFieldErrors(error);
      setErrors(fields);
      if (statusOf(error) === 403) {
        setDenied(true);
        setSaveError("Недостаточно прав для сохранения. Обновите сведения о пространстве. Введённые настройки сохранены в форме.");
        void queryClient.invalidateQueries({ queryKey: [...scope, "detail", organization.id] });
      } else if (statusOf(error) === 404) {
        setDenied(true); setSaveError("Пространство недоступно. Введённые настройки сохранены в форме.");
      } else setSaveError(uncertain(error) ? "Не удалось подтвердить сохранение. Проверьте настройки и повторите." : "Не удалось сохранить настройки. Проверьте поля и повторите.");
      focusError(`org-${organization.id}`, fields);
    },
  });
  const members = useQuery({ queryKey: [...scope, "members", organization.id], queryFn: () => organizationApi.members(organization.id), enabled: editable, retry: false });
  return <section className="space-y-6" aria-label="Выбранное рабочее пространство">
    <h2 className="break-words text-xl font-semibold">{organization.name}</h2>
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Настройки</h3>
      <p className="mb-4 text-sm text-muted-foreground">Ваша роль: {roleLabel[organization.role]}</p>
      <form onSubmit={(event) => {
        event.preventDefault(); if (!editable || save.isPending || !dirty) return;
        const found = validation(draft); setErrors(found); setMessage(""); setSaveError("");
        if (Object.keys(found).length) { focusError(`org-${organization.id}`, found); return; }
        save.mutate({ ...draft, name: draft.name.trim(), timezone: draft.timezone.trim() });
      }} className="space-y-4">
        <SettingsFields prefix={`org-${organization.id}`} value={draft} onChange={(value) => { setDraft(value); setMessage(""); }} disabled={!editable || save.isPending} errors={errors} nameRef={nameRef} />
        {!editable && <p className="text-sm text-muted-foreground">Изменять настройки могут владелец и администратор.</p>}
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
        {message && <p role="status" className="text-sm text-primary">{message}</p>}
        {editable && <Button type="submit" loading={save.isPending} disabled={!dirty}>Сохранить настройки</Button>}
      </form>
    </Card>
    {editable && <Card>
      <h3 className="mb-4 text-lg font-semibold">Участники</h3>
      {members.isPending ? <AsyncState kind="loading" title="Загружаем участников…" /> : members.isError ?
        <AsyncState kind="error" title="Не удалось загрузить участников" onRetry={() => void members.refetch()} /> :
        members.data?.length ? <ul className="divide-y divide-border">{members.data.map((member) => <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <span className="min-w-0 break-words">{[member.first_name, member.last_name].filter(Boolean).join(" ") || `Участник №${member.user_id}`}</span>
          <span className="text-sm text-muted-foreground">{roleLabel[member.role]}</span>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">Участников пока нет</p>}
    </Card>}
  </section>;
}

function Workspaces({ scope }: { scope: Scope }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState<OrganizationSettings>(defaults);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [createError, setCreateError] = useState("");
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [message, setMessage] = useState("");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const unsaved = settingsDirty || (showCreate && JSON.stringify(draft) !== JSON.stringify(defaults));
  const nameRef = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const list = useQuery({ queryKey: [...scope, "list"], queryFn: organizationApi.list, retry: false });
  const effectiveId = list.data?.some((org) => org.id === selectedId) ? selectedId : null;
  const detail = useQuery({ queryKey: [...scope, "detail", effectiveId], queryFn: () => organizationApi.get(effectiveId!), enabled: effectiveId !== null, retry: false });
  useEffect(() => { if (showCreate) nameRef.current?.focus(); }, [showCreate]);
  useEffect(() => {
    document.body.dataset.unsavedOrganization = unsaved ? "true" : "false";
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    if (unsaved) window.addEventListener("beforeunload", warn);
    return () => {
      delete document.body.dataset.unsavedOrganization;
      window.removeEventListener("beforeunload", warn);
    };
  }, [unsaved]);
  useEffect(() => {
    if (statusOf(detail.error) === 404) void queryClient.invalidateQueries({ queryKey: [...scope, "list"] });
  }, [detail.error, queryClient, scope]);
  function select(id: number) {
    if (selectedId === id) return;
    if (settingsDirty && !window.confirm("Есть несохранённые настройки. Перейти к другому пространству без сохранения?")) return;
    // A previous successful response is not evidence of current membership.
    queryClient.removeQueries({ queryKey: [...scope, "detail", id], exact: true });
    queryClient.removeQueries({ queryKey: [...scope, "members", id], exact: true });
    setSelectedId(id); setSettingsDirty(false); setMessage("");
  }
  const create = useMutation({
    mutationFn: organizationApi.create, retry: false,
    onSuccess: (organization) => {
      queryClient.setQueryData<Organization[]>([...scope, "list"], (old) => [...(old ?? []), organization]);
      setSelectedId(organization.id); setSettingsDirty(false); setShowCreate(false); setDraft(defaults);
      setMessage("Рабочее пространство создано"); setCreateError("");
      void queryClient.invalidateQueries({ queryKey: [...scope, "list"] });
    },
    onError: (error) => {
      const fields = serverFieldErrors(error);
      setErrors(fields);
      setCreationUncertain(uncertain(error));
      setCreateError(uncertain(error) ? "Не удалось подтвердить создание. Обновите список перед повторной попыткой." : statusOf(error) === 403 ? "Создавать рабочие пространства может преподаватель." : "Не удалось создать пространство. Проверьте поля и повторите.");
      focusError("new-org", fields);
    },
  });
  return <div className="page-shell mx-auto max-w-5xl space-y-6 p-4 md:p-6">
    <Link href="/teacher/profile" className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground" onClick={(event) => {
      if (unsaved && !window.confirm("Есть несохранённые настройки. Выйти без сохранения?")) event.preventDefault();
    }}>← Профиль</Link>
    <PageHeader title="Рабочие пространства" description="Настройте организацию для школы или частной практики" action={
      <Button ref={createButton} onClick={() => setShowCreate(true)} disabled={showCreate || create.isPending}>Создать пространство</Button>
    } />
    <Card className="bg-accent"><p className="text-sm leading-relaxed">Здесь настраиваются организации. Группы, уроки и тесты вашего личного кабинета пока не перенесены в рабочие пространства.</p></Card>
    {message && <p role="status" className="text-sm text-primary">{message}</p>}
    {showCreate && <Card>
      <h2 className="mb-4 text-lg font-semibold">Новое рабочее пространство</h2>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault(); if (create.isPending || creationUncertain) return;
        const found = validation(draft); setErrors(found); setCreateError("");
        if (Object.keys(found).length) { focusError("new-org", found); return; }
        if (settingsDirty && !window.confirm("Есть несохранённые настройки. Создать новое пространство без их сохранения?")) return;
        create.mutate({ ...draft, name: draft.name.trim(), timezone: draft.timezone.trim() });
      }}>
        <SettingsFields prefix="new-org" value={draft} onChange={setDraft} disabled={create.isPending} errors={errors} nameRef={nameRef} />
        {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
        {creationUncertain && <Button variant="outline" type="button" loading={list.isFetching} onClick={async () => {
          const result = await list.refetch(); if (result.isSuccess) { setCreationUncertain(false); setCreateError("Список обновлён. Проверьте, появилось ли пространство, прежде чем создавать его снова."); }
        }}>Обновить список</Button>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={create.isPending} disabled={creationUncertain}>Создать пространство</Button>
          <Button type="button" variant="outline" disabled={create.isPending} onClick={() => { setShowCreate(false); createButton.current?.focus(); }}>Отмена</Button>
        </div>
      </form>
    </Card>}
    <section aria-label="Ваши рабочие пространства" className="space-y-4">
      <h2 className="text-lg font-semibold">Ваши пространства</h2>
      {list.isPending ? <AsyncState kind="loading" title="Загружаем рабочие пространства…" /> : list.isError ? <AsyncState kind="error" title="Не удалось загрузить пространства" onRetry={() => void list.refetch()} /> :
        list.data?.length ? <div className="grid gap-4 md:grid-cols-2">{list.data.map((organization) => <Card key={organization.id} className={organization.id === effectiveId ? "border-primary" : ""}>
          <h3 className="break-words text-lg font-semibold">{organization.name}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{roleLabel[organization.role]}</p>
          <p className="mt-1 break-words text-sm text-muted-foreground">{organization.timezone} · {organization.locale === "kk" ? "Қазақша" : "Русский"}</p>
          {organization.id === effectiveId && <p className="mt-3 text-sm font-medium text-primary">Выбрано для настройки</p>}
          <Button className="mt-4" variant="outline" aria-pressed={organization.id === effectiveId} onClick={() => select(organization.id)}>Настроить<span className="sr-only"> {organization.name}</span></Button>
        </Card>)}</div> : <AsyncState title="Рабочих пространств пока нет" description="Создайте организацию для школы или частной практики с помощью кнопки выше." />}
    </section>
    {effectiveId !== null && (detail.isPending ? <AsyncState kind="loading" title="Загружаем настройки…" /> : detail.isError ? <AsyncState kind="error" title={statusOf(detail.error) === 404 ? "Пространство недоступно" : "Не удалось загрузить настройки"} onRetry={() => void detail.refetch()} /> : detail.data &&
      <OrganizationEditor key={effectiveId} organization={detail.data} scope={scope} onDirtyChange={setSettingsDirty} />)}
    {effectiveId === null && !list.isPending && !list.isError && Boolean(list.data?.length) && <p className="text-sm text-muted-foreground">Выберите пространство для настройки.</p>}
  </div>;
}

export default function OrganizationsPage() {
  const { user, sessionVersion, accessToken } = useAuthStore();
  if (!user || !accessToken) return null;
  return <Workspaces key={`${user.id}-${sessionVersion}`} scope={["organizations", user.id, sessionVersion]} />;
}
