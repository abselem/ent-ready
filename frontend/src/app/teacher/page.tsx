"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Group {
  id: number;
  name: string;
  city: string;
  school: string;
  category: string;
}

const categories = [
  { value: "school", label: "Школа" },
  { value: "course", label: "Курс" },
  { value: "platform", label: "От нас" },
] as const;

export default function TeacherGroupsPage() {
  const qc = useQueryClient();
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [school, setSchool] = useState("");
  const [category, setCategory] = useState<"school" | "course" | "platform">("school");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const { data: groups = [], isLoading, isError, refetch } = useQuery<Group[]>({
    queryKey: ["groups"],
    queryFn: async () => (await api.get("/groups")).data ?? [],
  });
  const createGroup = useMutation({
    mutationFn: (body: { name: string; city: string; school: string; category: string }) => api.post("/groups", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      setSuccess(`Группа «${name}» создана. Откройте её, чтобы продолжить работу.`);
      setShowForm(false);
      setName(""); setCity(""); setSchool(""); setCategory("school"); setError("");
      requestAnimationFrame(() => statusRef.current?.focus());
    },
    onError: () => setError("Не удалось создать группу. Проверьте данные и попробуйте ещё раз."),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="mb-2 text-sm font-medium text-muted-foreground">Рабочее пространство учителя</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Мои группы</h1><p className="mt-2 text-sm text-muted-foreground">Учебные группы и материалы для ваших учеников.</p></div>
        <Button className="shrink-0" aria-expanded={showForm} aria-controls="group-create" disabled={createGroup.isPending} onClick={() => setShowForm(!showForm)}>{showForm ? "Закрыть форму" : <><Plus aria-hidden="true" size={18} />Создать группу</>}</Button>
      </header>
      <p ref={statusRef} tabIndex={-1} role="status" className={success ? "rounded-xl border border-border bg-accent p-4 text-sm" : "sr-only"}>{success}</p>
      {showForm && <Card id="group-create" className="max-w-3xl">
        <CardHeader><CardTitle>Новая группа</CardTitle><p className="mt-1 text-sm text-muted-foreground">Укажите название и организацию, чтобы ученикам было проще найти свою группу.</p></CardHeader>
        <CardContent><form onSubmit={(e) => { e.preventDefault(); setError(""); createGroup.mutate({ name, city, school, category }); }} className="space-y-5">
          <Input id="name" maxLength={20} label="Название группы" placeholder="Например, Математика 10А" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="grid gap-4 sm:grid-cols-2"><Input id="city" maxLength={100} label="Город" placeholder="Алматы" value={city} onChange={(e) => setCity(e.target.value)} required /><Input id="school" maxLength={255} label="Школа / организация" placeholder="Название организации" value={school} onChange={(e) => setSchool(e.target.value)} required /></div>
          <fieldset><legend className="mb-2 text-sm font-medium text-foreground">Тип группы</legend><div className="flex flex-wrap gap-3">{categories.map((option) => <label key={option.value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm ${category === option.value ? "border-primary bg-accent text-foreground" : "border-control-border"}`}><input type="radio" name="category" value={option.value} checked={category === option.value} onChange={() => setCategory(option.value)} className="accent-primary" />{option.label}</label>)}</div></fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap gap-3"><Button type="submit" loading={createGroup.isPending}>Создать группу</Button><Button variant="ghost" type="button" disabled={createGroup.isPending} onClick={() => setShowForm(false)}>Отмена</Button></div>
        </form></CardContent>
      </Card>}
      <section aria-label="Список групп">
        {isLoading ? <div role="status" className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">Загружаем группы…</div> : isError ? <Card><p role="alert" className="mb-4 text-sm">Не удалось загрузить группы.</p><Button variant="outline" onClick={() => refetch()}>Повторить</Button></Card> : groups.length === 0 ? <Card className="py-10 text-center"><Users aria-hidden="true" className="mx-auto mb-4 text-muted-foreground" size={28} /><CardTitle>Создайте первую группу</CardTitle><p className="mt-2 text-sm text-muted-foreground">Здесь появятся ваши учебные группы.</p><Button className="mt-5" variant="outline" onClick={() => setShowForm(true)}>Создать группу</Button></Card> : <div className="grid gap-4 md:grid-cols-2">{groups.map((group) => <Link key={group.id} href={`/teacher/groups/${group.id}`} className="group rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
          <div className="mb-4 flex items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary"><Users aria-hidden="true" size={20} /></span><span className="text-xs font-medium text-muted-foreground">{categories.find((c) => c.value === group.category)?.label ?? "Учебная группа"}</span></div>
          <h2 className="break-words text-lg font-semibold text-foreground">{group.name}</h2><p className="mt-1 break-words text-sm text-muted-foreground">{[group.city, group.school].filter(Boolean).join(" · ")}</p><span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary">Открыть группу<ArrowRight size={16} aria-hidden="true" /></span>
        </Link>)}</div>}
      </section>
    </div>
  );
}
