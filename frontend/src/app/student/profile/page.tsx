"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, clearTokens } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Topic { id: number; name: string }
interface Group { id: number; name: string; city: string; school: string; invite_code: string }
interface UserFull {
  id: number; phone: string; first_name: string; last_name: string;
  profile_subject1: number | null; profile_subject2: number | null;
}

export default function StudentProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, setUser, logout } = useAuthStore();

  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // profile subjects
  const [sub1, setSub1] = useState<number | "">(user?.profile_subject1 ?? "");
  const [sub2, setSub2] = useState<number | "">(user?.profile_subject2 ?? "");

  // join group
  const [inviteCode, setInviteCode] = useState("");
  const [joinError, setJoinError] = useState("");

  const { data: topics = [] } = useQuery<Topic[]>({
    queryKey: ["topics"],
    queryFn: async () => (await api.get("/topics")).data,
  });

  const { data: myGroups = [], isLoading: groupsLoading } = useQuery<Group[]>({
    queryKey: ["joined-groups"],
    queryFn: async () => (await api.get("/groups/joined")).data,
  });

  const { data: meFull } = useQuery<UserFull>({
    queryKey: ["me-full"],
    queryFn: async () => (await api.get("/users/me")).data,
  });

  useEffect(() => {
    if (meFull) {
      setSub1(meFull.profile_subject1 ?? "");
      setSub2(meFull.profile_subject2 ?? "");
    }
  }, [meFull]);

  const updateProfile = useMutation({
    mutationFn: () => api.patch("/users/me", {
      first_name: firstName,
      last_name: lastName,
      profile_subject1: sub1 || null,
      profile_subject2: sub2 || null,
    }),
    onSuccess: async () => {
      const { data } = await api.get("/users/me");
      setUser(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setError("");
    },
    onError: () => setError("Не удалось сохранить"),
  });

  const setPassword = useMutation({
    mutationFn: () => api.post("/users/me/password", { password: newPassword }),
    onSuccess: () => {
      setNewPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: () => setError("Не удалось сменить пароль"),
  });

  const joinGroup = useMutation({
    mutationFn: () => api.post("/groups/join", { invite_code: inviteCode.trim().toUpperCase() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["joined-groups"] });
      setInviteCode("");
      setJoinError("");
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setJoinError(msg ?? "Не удалось вступить в группу");
    },
  });

  const leaveGroup = useMutation({
    mutationFn: (groupId: number) => api.delete(`/groups/${groupId}/leave`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["joined-groups"] }),
  });

  function handleLogout() {
    clearTokens();
    logout();
    router.push("/login");
  }

  const canJoin = myGroups.length < 2;

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Профиль</h1>

      {/* Personal info */}
      <Card className="mb-4">
        <CardHeader><CardTitle>Личные данные</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Input id="phone" label="Телефон" value={user?.phone ?? ""} disabled />
            <Input id="firstName" label="Имя" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <Input id="lastName" label="Фамилия" value={lastName} onChange={(e) => setLastName(e.target.value)} />

            {/* Profile subjects */}
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">
                Профильный предмет 1 <span className="text-muted-foreground font-normal">(ЕНТ)</span>
              </label>
              <select value={sub1} onChange={(e) => { setSub1(e.target.value ? Number(e.target.value) : ""); }}
                className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">Не выбран</option>
                <optgroup label="ЕНТ">
                  {topics.map((t) => <option key={t.id} value={t.id} disabled={t.id === sub2}>{t.name}</option>)}
                </optgroup>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">
                Профильный предмет 2 <span className="text-muted-foreground font-normal">(ЕНТ)</span>
              </label>
              <select value={sub2} onChange={(e) => setSub2(e.target.value ? Number(e.target.value) : "")}
                className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">Не выбран</option>
                <optgroup label="ЕНТ">
                  {topics.map((t) => <option key={t.id} value={t.id} disabled={t.id === sub1}>{t.name}</option>)}
                </optgroup>
              </select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && <p className="text-sm text-green-600">Сохранено!</p>}
            <Button loading={updateProfile.isPending} onClick={() => updateProfile.mutate()}>
              Сохранить
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Groups */}
      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Мои группы</CardTitle>
            <span className="text-xs text-muted-foreground">{myGroups.length}/2</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {groupsLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : myGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Вы ещё не вступили ни в одну группу</p>
            ) : (
              myGroups.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-2 border border-border rounded-lg p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{g.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{g.school} · {g.city}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive shrink-0 text-xs"
                    onClick={() => leaveGroup.mutate(g.id)} loading={leaveGroup.isPending}>
                    Выйти
                  </Button>
                </div>
              ))
            )}

            {canJoin && (
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-xs text-muted-foreground">Введите код группы (школа или курсы)</p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary font-mono uppercase tracking-widest"
                    placeholder="ABC123"
                    maxLength={8}
                    value={inviteCode}
                    onChange={(e) => { setInviteCode(e.target.value); setJoinError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && inviteCode.trim()) joinGroup.mutate(); }}
                  />
                  <Button size="sm" disabled={!inviteCode.trim()} loading={joinGroup.isPending}
                    onClick={() => joinGroup.mutate()}>
                    Вступить
                  </Button>
                </div>
                {joinError && <p className="text-sm text-destructive">{joinError}</p>}
              </div>
            )}

            {!canJoin && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                Максимум 2 группы. Выйдите из одной, чтобы вступить в другую.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Password */}
      <Card className="mb-4">
        <CardHeader><CardTitle>Сменить пароль</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Input id="password" label="Новый пароль" type="password" placeholder="••••••••"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <Button variant="outline" loading={setPassword.isPending}
              disabled={newPassword.length < 6} onClick={() => setPassword.mutate()}>
              Сменить пароль
            </Button>
          </div>
        </CardContent>
      </Card>

      <Button variant="ghost" className="w-full text-destructive" onClick={handleLogout}>
        Выйти из аккаунта
      </Button>
    </div>
  );
}
