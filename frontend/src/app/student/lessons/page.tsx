"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface Group {
  id: number;
  name: string;
  category: string; // platform | course | school
}

interface Lesson {
  id: number;
  title: string;
  description: { String: string; Valid: boolean } | null;
  scheduled_at: string | null;
  duration_min: number;
  group_id: number;
  section_title: string | null;
  section_num: number;
  order_num: number;
}

type Segment = "all" | "platform" | "course" | "school";

const SEGMENTS: { value: Segment; label: string; icon: string }[] = [
  { value: "all",      label: "Все",      icon: "◈" },
  { value: "platform", label: "От нас",   icon: "✦" },
  { value: "course",   label: "Курсы",    icon: "◎" },
  { value: "school",   label: "Школа",    icon: "◻" },
];

export default function StudentLessonsPage() {
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>("all");

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["joined-groups-lessons"],
    queryFn: async () => (await api.get("/groups/joined")).data,
  });

  const { data: lessons = [], isLoading } = useQuery<Lesson[]>({
    queryKey: ["student-lessons", groups.map(g => g.id)],
    queryFn: async () => {
      const all = await Promise.all(
        groups.map(g => api.get(`/groups/${g.id}/lessons`).then(r => (r.data ?? []) as Lesson[]))
      );
      return all.flat();
    },
    enabled: groups.length > 0,
  });

  // Filter by segment
  const groupById = Object.fromEntries(groups.map(g => [g.id, g]));
  const filtered = segment === "all"
    ? lessons
    : lessons.filter(l => groupById[l.group_id]?.category === segment);

  // Count per segment for badges
  const counts = {
    all:      lessons.length,
    platform: lessons.filter(l => groupById[l.group_id]?.category === "platform").length,
    course:   lessons.filter(l => groupById[l.group_id]?.category === "course").length,
    school:   lessons.filter(l => groupById[l.group_id]?.category === "school").length,
  };

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-5">Уроки</h1>

      {/* Segment control */}
      <div className="flex rounded-2xl border border-border bg-muted/30 p-1 mb-5 gap-1">
        {SEGMENTS.filter(s => s.value === "all" || counts[s.value] > 0).map(s => (
          <button
            key={s.value}
            onClick={() => setSegment(s.value)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium transition-all ${
              segment === s.value
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="text-base leading-none">{s.icon}</span>
            <span>{s.label}</span>
            {counts[s.value] > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                segment === s.value ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {counts[s.value]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Lessons list */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {lessons.length === 0
            ? "Нет доступных уроков"
            : "Нет уроков в этом разделе"}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((lesson, idx) => {
            const group = groupById[lesson.group_id];
            const catLabel = group?.category === "platform" ? "От нас"
              : group?.category === "course" ? "Курс" : "Школа";
            const catColor = group?.category === "platform"
              ? "bg-purple-500/10 text-purple-400"
              : group?.category === "course"
              ? "bg-blue-500/10 text-blue-400"
              : "bg-green-500/10 text-green-400";

            return (
              <button
                key={lesson.id}
                onClick={() => router.push(`/student/lessons/${lesson.id}`)}
                className="text-left w-full border border-border rounded-2xl p-4 bg-card hover:border-primary transition-colors active:scale-[0.99] flex items-center gap-4"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    {segment === "all" && (
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${catColor}`}>
                        {catLabel}
                      </span>
                    )}
                    {lesson.section_title && (
                      <span className="text-xs text-muted-foreground truncate">{lesson.section_title}</span>
                    )}
                  </div>
                  <p className="font-medium text-sm leading-snug truncate">{lesson.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {group?.name}
                    {lesson.scheduled_at && ` · ${formatDate(lesson.scheduled_at)}`}
                    {lesson.duration_min > 0 && ` · ${lesson.duration_min} мин`}
                  </p>
                </div>
                <svg className="w-4 h-4 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
