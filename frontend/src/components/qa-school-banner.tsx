"use client";

import Link from "next/link";
import { useQaSchool } from "@/lib/qa-school";

export function QaSchoolBanner() {
  const { data } = useQaSchool();
  if (!data?.is_qa) return null;
  return <aside aria-label="Тестовая школа" className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-accent px-4 py-3 text-sm md:mx-6">
    <div className="min-w-0">
      <p className="break-words font-semibold">{data.organization_name}</p>
      <p className="break-words text-muted-foreground">{data.active ? `Тестовая школа · ${data.group_name}` : "Доступ к тестовой школе приостановлен"}</p>
    </div>
    {data.active && <Link className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={data.role !== "student" ? `/teacher/groups/${data.group_id}` : "/student/lessons"}>Материалы школы</Link>}
  </aside>;
}
