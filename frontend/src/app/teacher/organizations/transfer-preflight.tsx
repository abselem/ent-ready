"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { organizationApi, type Organization, type TransferCandidates, type TransferPreflight, type TransferResourceType, type TransferSelection } from "@/lib/organizations-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AsyncState } from "@/components/ui/async-state";

type Scope = readonly ["organizations", number, number];
const choices = {
  group: { label: "Группа", placeholder: "Выберите группу", empty: "У вас пока нет групп для проверки", key: "groups" },
  lesson: { label: "Урок", placeholder: "Выберите урок", empty: "У вас пока нет уроков для проверки", key: "lessons" },
  test: { label: "Тест", placeholder: "Выберите тест", empty: "У вас пока нет тестов для проверки", key: "tests" },
} as const;
const countLabels = { groups: "Группы", lessons: "Уроки", tests: "Тесты", questions: "Вопросы", contexts: "Контексты" };
function statusOf(error: unknown) { return isAxiosError(error) ? error.response?.status : undefined; }

// A successful HTTP response cannot enable an execution action, even if the
// backend contract changes accidentally. Check both scope and readonly flags.
function validReport(report: TransferPreflight, organizationId: number, selection: TransferSelection) {
  return report?.target_organization_id === organizationId
    && report.execution_allowed === false && report.tenant_enforcement_ready === false
    && report.resource?.id === selection.resource_id && report.resource.type === selection.resource_type
    && typeof report.resource.title === "string" && Number.isFinite(Date.parse(report.as_of))
    && Object.keys(countLabels).every((key) => Number.isInteger(report.counts?.[key as keyof typeof countLabels]) && report.counts[key as keyof typeof countLabels] >= 0)
    && Array.isArray(report.blockers) && report.blockers.every((item) => item !== null && typeof item === "object" && typeof item.code === "string" && typeof item.message === "string" && Number.isInteger(item.count) && item.count >= 0)
    && typeof report.notice === "string";
}

function PreflightForm({ organization, candidates, scope, refreshCandidates }: {
  organization: Organization; candidates: TransferCandidates; scope: Scope; refreshCandidates: () => void;
}) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<TransferResourceType>("group");
  const [resourceId, setResourceId] = useState<number | null>(null);
  const [report, setReport] = useState<TransferPreflight | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const revision = useRef(0);
  useEffect(() => () => { revision.current += 1; }, []);
  const choice = choices[type];
  const materials = candidates[choice.key];
  const selected = materials.find((item) => item.id === resourceId);
  const duplicates = new Map<string, number>();
  for (const material of materials) duplicates.set(material.title, (duplicates.get(material.title) ?? 0) + 1);
  const check = useMutation({
    mutationFn: ({ selection }: { selection: TransferSelection; revision: number }) => organizationApi.transferPreflight(organization.id, selection),
    retry: false,
    onSuccess: (result, submitted) => {
      if (submitted.revision !== revision.current) return;
      if (!validReport(result, organization.id, submitted.selection)) {
        setError("Не удалось подтвердить результат проверки. Обновите страницу или повторите позже.");
        return;
      }
      setReport(result);
    },
    onError: (failure, submitted) => {
      if (submitted.revision !== revision.current) return;
      const status = statusOf(failure);
      if (status === 403) {
        setDenied(true);
        setError("Для проверки нужны права владельца или администратора пространства.");
        void queryClient.invalidateQueries({ queryKey: [...scope, "detail", organization.id] });
      } else if (status === 404) {
        setError("Материал или пространство недоступны. Обновите список и выберите материал снова.");
        void queryClient.invalidateQueries({ queryKey: [...scope, "detail", organization.id] });
      } else if (status === 400) setError("Не удалось проверить выбранный материал. Обновите список и выберите его снова.");
      else setError("Не удалось получить результат проверки. Данные не переносились. Повторите проверку.");
    },
  });
  function clearResult() { revision.current += 1; setReport(null); setError(""); }
  return <div className="space-y-4" aria-busy={check.isPending || undefined}>
    {!denied && <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault(); if (!selected || check.isPending) return;
      clearResult();
      check.mutate({ selection: { resource_type: type, resource_id: selected.id }, revision: revision.current });
    }}>
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={`transfer-${organization.id}-type`} className="text-sm font-medium">Что проверить</label>
          <select id={`transfer-${organization.id}-type`} className="control-field w-full min-w-0" value={type} onChange={(event) => {
            clearResult(); setType(event.target.value as TransferResourceType); setResourceId(null);
          }}>
            {Object.entries(choices).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}
          </select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={`transfer-${organization.id}-material`} className="text-sm font-medium">Материал</label>
          <select id={`transfer-${organization.id}-material`} className="control-field w-full min-w-0" value={resourceId ?? ""} disabled={!materials.length}
            aria-describedby={`transfer-${organization.id}-selection`} onChange={(event) => {
              clearResult(); setResourceId(event.target.value ? Number(event.target.value) : null);
            }}>
            <option value="">{choice.placeholder}</option>
            {materials.map((material) => <option key={material.id} value={material.id}>{material.title}{(duplicates.get(material.title) ?? 0) > 1 ? ` · №${material.id}` : ""}</option>)}
          </select>
        </div>
      </div>
      <p id={`transfer-${organization.id}-selection`} className="break-words text-sm text-muted-foreground">{selected ? selected.title : materials.length ? "Выберите собственный материал по названию." : choice.empty}</p>
      {candidates.has_more[choice.key] && <p className="text-sm text-muted-foreground">Показаны последние 100 материалов этого типа. Список неполный.</p>}
      <Button type="submit" className="max-w-full" loading={check.isPending} disabled={!selected}>{check.isPending ? "Проверяем…" : "Проверить перенос"}</Button>
    </form>}
    {check.isPending && <p role="status" className="text-sm text-muted-foreground">Проверяем связанные данные…</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{!denied && <Button type="button" variant="outline" onClick={() => { clearResult(); refreshCandidates(); }}>Обновить список</Button>}</div>}
    {report && selected && <section className="space-y-4 rounded-xl border border-border bg-muted/30 p-4" aria-label="Результат предварительной проверки">
      <p role="status" className="sr-only">Предварительная проверка завершена</p>
      <h4 className="text-base font-semibold">Предварительная проверка</h4>
      <dl className="space-y-2 text-sm">
        <div><dt className="text-muted-foreground">Источник</dt><dd className="break-words">{choices[report.resource.type].label}: {report.resource.title} · №{report.resource.id}</dd></div>
        <div><dt className="text-muted-foreground">Назначение</dt><dd className="break-words">{organization.name}</dd></div>
        <div><dt className="text-muted-foreground">Снимок данных</dt><dd>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(report.as_of))} UTC</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">Зависимости могли измениться после проверки. Для обновления запустите проверку ещё раз.</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{Object.entries(countLabels).map(([key, label]) => <div key={key} className="min-w-0"><dt className="break-words text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-semibold">{report.counts[key as keyof typeof countLabels]}</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">Учтены только ваши объекты в выбранном наборе.</p>
      {report.blockers.length ? <div className="space-y-2"><h5 className="font-medium">Найдены препятствия</h5><ul className="list-disc space-y-2 pl-5 text-sm">{report.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`} className="break-words">{blocker.message} <span className="text-muted-foreground">Количество: {blocker.count}</span></li>)}</ul></div> : <p className="text-sm">В проверенных зависимостях препятствий не найдено. Перенос всё равно недоступен.</p>}
      <p className="break-words text-sm text-muted-foreground">{report.notice}</p>
      <p className="text-sm font-medium">Фактический перенос недоступен. Изоляция учебных данных организаций ещё не включена.</p>
    </section>}
  </div>;
}

export function TransferPreflightCard({ organization, scope }: { organization: Organization; scope: Scope }) {
  const queryClient = useQueryClient();
  const candidates = useQuery({ queryKey: [...scope, "transfer-candidates", organization.id], queryFn: () => organizationApi.transferCandidates(organization.id), retry: false });
  const status = statusOf(candidates.error);
  useEffect(() => {
    if (status === 403 || status === 404) void queryClient.invalidateQueries({ queryKey: [...scope, "detail", organization.id] });
  }, [status, queryClient, organization.id, scope]);
  // Inventory changes remount the form, invalidating a vanished selection and
  // any in-flight report that could otherwise reappear after a later refresh.
  const inventoryKey = candidates.data ? [candidates.data.groups, candidates.data.lessons, candidates.data.tests].map((items) => items.map((item) => item.id).join(",")).join(";") : "";
  return <Card>
    <h3 className="mb-3 text-lg font-semibold">Подготовка переноса</h3>
    <p className="mb-5 text-sm leading-relaxed text-muted-foreground">Выберите собственную группу, урок или тест и проверьте связанные данные перед ручным переносом. Материалы «Для всех» останутся в отдельном общем каталоге. Проверка не переносит данные. Фактический перенос пока недоступен.</p>
    {candidates.isPending ? <AsyncState kind="loading" title="Загружаем ваши материалы…" /> : candidates.isError ? <AsyncState kind="error"
      title={status === 403 ? "Для проверки нужны права владельца или администратора пространства" : status === 404 ? "Материал или пространство недоступны" : "Не удалось загрузить материалы"}
      onRetry={status === 403 ? undefined : () => void candidates.refetch()} /> : candidates.data && <PreflightForm
      key={`${scope.join(":")}:${organization.id}:${inventoryKey}`} organization={organization} candidates={candidates.data} scope={scope} refreshCandidates={() => void candidates.refetch()} />}
  </Card>;
}
