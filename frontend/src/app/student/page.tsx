"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Test {
  id: number;
  title: string;
  max_attempts: number;
  is_public: boolean;
  time_limit: { Int16: number; Valid: boolean } | null;
}

export default function StudentTestsPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  const { data: groups = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["student-groups"],
    queryFn: async () => (await api.get("/groups")).data,
  });

  const { data: groupTests = [] } = useQuery<Test[]>({
    queryKey: ["student-group-tests"],
    queryFn: async () => {
      const all = await Promise.all(
        groups.map((g) => api.get(`/groups/${g.id}/tests`).then((r) => (r.data ?? []) as Test[]))
      );
      return (all.flat() as Test[]).filter((t: Test & { is_published?: boolean }) => t.is_published);
    },
    enabled: groups.length > 0,
  });

  const { data: publicTests = [] } = useQuery<Test[]>({
    queryKey: ["public-tests"],
    queryFn: async () => (await api.get("/tests/public")).data,
  });

  // Объединяем, убирая дубли (публичный тест может быть и в группе)
  const allTests = [
    ...publicTests,
    ...groupTests.filter((t) => !publicTests.some((p) => p.id === t.id)),
  ];

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Привет, {user?.first_name}!</h1>
        <p className="text-muted-foreground mt-1">Доступные тесты</p>
      </div>

      {allTests.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет доступных тестов</div>
      ) : (
        <div className="flex flex-col gap-3">
          {allTests.map((test) => (
            <button key={test.id} onClick={() => router.push(`/student/tests/${test.id}`)} className="text-left w-full">
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{test.title}</CardTitle>
                    {test.is_public && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 shrink-0">
                        Публичный
                      </span>
                    )}
                  </div>
                  <CardContent className="p-0 mt-1 text-sm text-muted-foreground flex gap-3">
                    <span>Попыток: {test.max_attempts}</span>
                    {test.time_limit?.Valid && test.time_limit.Int16 > 0 && (
                      <span>⏱ {test.time_limit.Int16} мин</span>
                    )}
                  </CardContent>
                </CardHeader>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
