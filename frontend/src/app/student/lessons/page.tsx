"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Group {
  id: number;
  name: string;
}

interface Lesson {
  id: number;
  title: string;
  content: string;
  scheduled_at: string | null;
  group_id: number;
}

export default function StudentLessonsPage() {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: groups = [] } = useQuery<Group[]>({
    queryKey: ["student-groups"],
    queryFn: async () => (await api.get("/groups")).data,
  });

  const { data: lessons = [], isLoading } = useQuery<Lesson[]>({
    queryKey: ["student-lessons"],
    queryFn: async () => {
      const all = await Promise.all(
        groups.map((g) =>
          api.get(`/groups/${g.id}/lessons`).then((r) => r.data?.lessons ?? [])
        )
      );
      return all.flat();
    },
    enabled: groups.length > 0,
  });

  function formatDate(iso: string | null) {
    if (!iso) return null;
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Уроки</h1>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
      ) : lessons.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет доступных уроков</div>
      ) : (
        <div className="flex flex-col gap-3">
          {lessons.map((lesson) => (
            <button
              key={lesson.id}
              className="text-left w-full"
              onClick={() => setExpandedId(expandedId === lesson.id ? null : lesson.id)}
            >
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="text-base">{lesson.title}</CardTitle>
                  {lesson.scheduled_at && (
                    <CardContent className="p-0 mt-1 text-sm text-muted-foreground">
                      {formatDate(lesson.scheduled_at)}
                    </CardContent>
                  )}
                </CardHeader>
                {expandedId === lesson.id && lesson.content && (
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{lesson.content}</p>
                  </CardContent>
                )}
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
