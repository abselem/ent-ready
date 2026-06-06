"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Group {
  id: number;
  name: string;
  description: string;
}

async function fetchGroups(): Promise<Group[]> {
  const { data } = await api.get("/groups");
  return data;
}

export default function TeacherGroupsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [school, setSchool] = useState("");
  const [category, setCategory] = useState<"school" | "course" | "platform">("school");
  const [error, setError] = useState("");

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ["groups"],
    queryFn: fetchGroups,
  });

  const createGroup = useMutation({
    mutationFn: (body: { name: string; city: string; school: string; category: string }) =>
      api.post("/groups", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      setShowForm(false);
      setName(""); setCity(""); setSchool(""); setCategory("school"); setError("");
    },
    onError: () => setError("Не удалось создать группу"),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createGroup.mutate({ name, city, school, category });
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Мои группы</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Отмена" : "Создать группу"}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Новая группа</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <Input
                id="name"
                label="Название группы"
                placeholder="Математика 10А"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Input
                id="city"
                label="Город"
                placeholder="Алматы"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
              />
              <Input
                id="school"
                label="Школа / Организация"
                placeholder="НИШ №1"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
                required
              />
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium">Тип группы</label>
                <div className="flex rounded-xl border border-border overflow-hidden">
                  {([
                    { value: "school",   label: "Школа" },
                    { value: "course",   label: "Курс" },
                    { value: "platform", label: "От нас" },
                  ] as const).map(opt => (
                    <button key={opt.value} type="button"
                      onClick={() => setCategory(opt.value)}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        category === opt.value ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" loading={createGroup.isPending}>
                Создать
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground">Загрузка...</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Нет групп. Создайте первую!
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <button
              key={group.id}
              onClick={() => router.push(`/teacher/groups/${group.id}`)}
              className="text-left w-full"
            >
              <Card className="hover:border-primary transition-colors cursor-pointer">
                <CardHeader>
                  <CardTitle className="text-base">{group.name}</CardTitle>
                  {group.description && (
                    <CardContent className="p-0 mt-1 text-sm text-muted-foreground">
                      {group.description}
                    </CardContent>
                  )}
                </CardHeader>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
