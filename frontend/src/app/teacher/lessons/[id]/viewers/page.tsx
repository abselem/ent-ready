"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { api } from "@/lib/api";

interface Viewer {
  user_id: number;
  first_name: string;
  last_name: string;
  phone: string;
  viewed_at: string;
}

interface Lesson { id: number; title: string; view_count: number }

export default function LessonViewersPage() {
  const { id } = useParams();
  const lessonId = Number(id);
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: lesson } = useQuery<Lesson>({
    queryKey: ["lesson", lessonId],
    queryFn: async () => (await api.get(`/lessons/${lessonId}`)).data,
    enabled: !!lessonId,
  });

  const { data: viewers = [], isLoading } = useQuery<Viewer[]>({
    queryKey: ["lesson-viewers", lessonId, search],
    queryFn: async () => (await api.get(`/lessons/${lessonId}/viewers?search=${encodeURIComponent(search)}`)).data,
    enabled: !!lessonId,
  });

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(`/teacher/lessons/${lessonId}`)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <div>
          <h1 className="text-lg font-bold">Просмотры урока</h1>
          <p className="text-xs text-muted-foreground truncate max-w-xs">{lesson?.title ?? "..."}</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-2xl font-bold">{lesson?.view_count ?? 0}</p>
          <p className="text-xs text-muted-foreground">уникальных</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по ФИО..."
          className="w-full border border-border rounded-xl pl-9 pr-4 py-2.5 bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {/* Viewers list */}
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[1,2,3].map(i => <div key={i} className="h-14 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : viewers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search ? "Никто не найден" : "Пока никто не просматривал этот урок"}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {viewers.map((v, i) => (
            <div key={v.user_id} className="flex items-center gap-3 border border-border rounded-xl p-3 bg-card">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{v.first_name} {v.last_name}</p>
                <p className="text-xs text-muted-foreground">{v.phone}</p>
              </div>
              <p className="text-xs text-muted-foreground shrink-0">{formatDate(v.viewed_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
