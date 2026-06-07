"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, clearTokens, apiOrigin } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface Topic { id: number; name: string }
interface Group { id: number; name: string; city: string; school: string; invite_code: string }
interface UserFull {
  id: number;
  phone: { String: string; Valid: boolean } | null;
  email: { String: string; Valid: boolean } | null;
  first_name: string; last_name: string;
  profile_subject1: number | null; profile_subject2: number | null;
  avatar_url: { String: string; Valid: boolean } | null;
}
interface ActivityData {
  days: { date: string; count: number }[];
  current_streak: number;
  max_streak: number;
  total_solved: number;
}

// ── Activity Heatmap ────────────────────────────────────────────────────────

const CELL = 12; // px
const GAP  = 2;  // px
const COL  = CELL + GAP; // 14px per week column

function cellColor(count: number) {
  if (count === 0)  return "#2d3748"; // visible empty cell
  if (count <= 5)   return "#86efac"; // soft green
  if (count <= 10)  return "#22c55e"; // medium green
  return              "#15803d";      // dark green
}

const MONTH_NAMES = ["янв","февр","март","апр","май","июнь","июль","авг","сент","окт","нояб","дек"];

function ActivityHeatmap({ data }: { data: ActivityData }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  // Align start to the Sunday 52 full weeks back
  const start = new Date(today);
  start.setDate(start.getDate() - 52 * 7 - today.getDay());

  const dayMap = new Map(data.days.map(d => [d.date, d.count]));

  type Cell = { date: string; count: number; today: boolean; future: boolean };
  const weeks: Cell[][] = [];
  const cur = new Date(start);
  for (let w = 0; w < 53; w++) {
    const week: Cell[] = [];
    for (let d = 0; d < 7; d++) {
      const ds = cur.toISOString().slice(0, 10);
      week.push({ date: ds, count: dayMap.get(ds) ?? 0,
        today: ds === todayStr, future: cur > today });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  // Month label row: one slot per week column
  const monthRow = weeks.map((week, wi) => {
    const d = new Date(week[0].date);
    const prev = wi > 0 ? new Date(weeks[wi - 1][0].date) : null;
    return (!prev || d.getMonth() !== prev.getMonth()) ? MONTH_NAMES[d.getMonth()] : "";
  });

  return (
    <div>
      {/* Grid + labels */}
      <div className="overflow-x-auto pb-1">
        <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
          {/* Month labels — same width as cell columns */}
          <div style={{ display: "flex", gap: GAP }}>
            {monthRow.map((label, wi) => (
              <div key={wi} style={{ width: CELL, flexShrink: 0, overflow: "visible", whiteSpace: "nowrap" }}
                className="text-xs text-muted-foreground">
                {label}
              </div>
            ))}
          </div>

          {/* Week columns */}
          <div style={{ display: "flex", gap: GAP }}>
            {weeks.map((week, wi) => (
              <div key={wi} style={{ display: "flex", flexDirection: "column", gap: GAP, flexShrink: 0 }}>
                {week.map(day => (
                  <div
                    key={day.date}
                    title={`${day.date}: ${day.count} тест${day.count === 1 ? "" : day.count < 5 ? "а" : "ов"}`}
                    style={{
                      width: CELL, height: CELL,
                      borderRadius: 3,
                      backgroundColor: day.future ? "transparent" : cellColor(day.count),
                      outline: day.today ? "2px solid #ef4444" : undefined,
                      outlineOffset: 1,
                      flexShrink: 0,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-6 mt-4 pt-4 border-t border-border">
        {[
          { label: "дней без перерыва",       value: data.current_streak },
          { label: "дней без перерыва (макс.)", value: data.max_streak },
          { label: "задач решено",             value: data.total_solved },
        ].map(s => (
          <div key={s.label}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Profile Page ─────────────────────────────────────────────────────────────

export default function StudentProfilePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, setUser, logout } = useAuthStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [phone, setPhone] = useState("");
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [sub1, setSub1] = useState<number | "">(user?.profile_subject1 ?? "");
  const [sub2, setSub2] = useState<number | "">(user?.profile_subject2 ?? "");
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

  const { data: activity } = useQuery<ActivityData>({
    queryKey: ["my-activity"],
    queryFn: async () => (await api.get("/users/me/activity")).data,
  });

  useEffect(() => {
    if (meFull) {
      setSub1(meFull.profile_subject1 ?? "");
      setSub2(meFull.profile_subject2 ?? "");
      setPhone(meFull.phone?.Valid ? meFull.phone.String : "");
    }
  }, [meFull]);

  const phoneValue = meFull?.phone?.Valid ? meFull.phone.String : "";
  const emailValue = meFull?.email?.Valid ? meFull.email.String : "";
  const hasPhone = !!phoneValue;

  const updatePhone = useMutation({
    mutationFn: () => api.put("/users/me/phone", { phone }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me-full"] });
      setPhoneSaved(true); setTimeout(() => setPhoneSaved(false), 2000);
    },
    onError: () => setError("Не удалось сохранить телефон"),
  });

  const avatarSrc = (() => {
    const raw = meFull?.avatar_url?.Valid ? meFull.avatar_url.String : null;
    return raw ? (raw.startsWith("/static/") ? `${apiOrigin}${raw}` : raw) : null;
  })();

  const initials = `${user?.first_name?.[0] ?? ""}${user?.last_name?.[0] ?? ""}`.toUpperCase();

  async function handleAvatarFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api.post("/users/me/avatar", formData);
      const { data: fresh } = await api.get("/users/me");
      setUser(fresh);
      qc.invalidateQueries({ queryKey: ["me-full"] });
    } catch { /* ignore */ } finally {
      setAvatarUploading(false);
      e.target.value = "";
    }
  }

  const updateProfile = useMutation({
    mutationFn: () => api.patch("/users/me", {
      first_name: firstName, last_name: lastName,
      profile_subject1: sub1 || null, profile_subject2: sub2 || null,
    }),
    onSuccess: async () => {
      const { data } = await api.get("/users/me");
      setUser(data);
      setSaved(true); setTimeout(() => setSaved(false), 2000); setError("");
    },
    onError: () => setError("Не удалось сохранить"),
  });

  const setPassword = useMutation({
    mutationFn: () => api.post("/users/me/password", { password: newPassword }),
    onSuccess: () => { setNewPassword(""); setSaved(true); setTimeout(() => setSaved(false), 2000); },
    onError: () => setError("Не удалось сменить пароль"),
  });

  const joinGroup = useMutation({
    mutationFn: () => api.post("/groups/join", { invite_code: inviteCode.trim().toUpperCase() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["joined-groups"] }); setInviteCode(""); setJoinError(""); },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setJoinError(msg ?? "Не удалось вступить в группу");
    },
  });

  const leaveGroup = useMutation({
    mutationFn: (groupId: number) => api.delete(`/groups/${groupId}/leave`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["joined-groups"] }),
  });

  const canJoin = myGroups.length < 2;

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Профиль</h1>

      {/* Personal info + Avatar */}
      <Card className="mb-4">
        <CardHeader><CardTitle>Личные данные</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {/* Avatar */}
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                {avatarSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarSrc} alt="avatar" className="w-20 h-20 rounded-2xl object-cover border border-border" />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center text-2xl font-bold text-primary-foreground">
                    {initials}
                  </div>
                )}
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors"
                  title="Изменить фото"
                >
                  {avatarUploading ? (
                    <svg className="w-3.5 h-3.5 animate-spin text-muted-foreground" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31" strokeLinecap="round"/></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  )}
                </button>
                <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.gif,.webp" className="hidden" onChange={handleAvatarFile} />
              </div>
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-foreground">{user?.first_name} {user?.last_name}</p>
                {emailValue && <p className="text-xs mt-0.5">{emailValue}</p>}
                {phoneValue && <p className="text-xs mt-0.5">{phoneValue}</p>}
                <p className="text-xs mt-1">JPG, PNG, WebP · макс. 10 МБ</p>
              </div>
            </div>

            {emailValue && (
              <Input id="email" label="Email" value={emailValue} disabled />
            )}
            <Input id="firstName" label="Имя" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <Input id="lastName" label="Фамилия" value={lastName} onChange={(e) => setLastName(e.target.value)} />

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Профильный предмет 1 <span className="text-muted-foreground font-normal">(ЕНТ)</span></label>
              <select value={sub1} onChange={(e) => setSub1(e.target.value ? Number(e.target.value) : "")}
                className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">Не выбран</option>
                <optgroup label="ЕНТ">
                  {topics.map((t) => <option key={t.id} value={t.id} disabled={t.id === sub2}>{t.name}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">Профильный предмет 2 <span className="text-muted-foreground font-normal">(ЕНТ)</span></label>
              <select value={sub2} onChange={(e) => setSub2(e.target.value ? Number(e.target.value) : "")}
                className="border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">Не выбран</option>
                <optgroup label="ЕНТ">
                  {topics.map((t) => <option key={t.id} value={t.id} disabled={t.id === sub1}>{t.name}</option>)}
                </optgroup>
              </select>
            </div>

            {/* Phone — prompted to add if missing */}
            {!hasPhone ? (
              <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-xl p-3">
                <p className="text-xs font-medium text-yellow-400 mb-2">📱 Укажите номер телефона</p>
                <div className="flex gap-2">
                  <input
                    type="tel" placeholder="+7 777 000 00 00"
                    value={phone} onChange={e => setPhone(e.target.value)}
                    className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={() => updatePhone.mutate()}
                    disabled={!phone.trim() || updatePhone.isPending}
                    className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {updatePhone.isPending ? "..." : "Сохранить"}
                  </button>
                </div>
                {phoneSaved && <p className="text-xs text-green-500 mt-1">Телефон сохранён!</p>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input id="phone" label="Телефон" value={phone}
                  onChange={e => setPhone(e.target.value)} />
                <button
                  onClick={() => updatePhone.mutate()}
                  disabled={phone === phoneValue || !phone.trim() || updatePhone.isPending}
                  className="mt-5 px-3 py-2 text-sm border border-border rounded-xl hover:bg-muted disabled:opacity-40 transition-colors shrink-0"
                >
                  {phoneSaved ? "✓" : "Сохр."}
                </button>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && <p className="text-sm text-green-600">Сохранено!</p>}
            <Button loading={updateProfile.isPending} onClick={() => updateProfile.mutate()}>Сохранить</Button>
          </div>
        </CardContent>
      </Card>

      {/* Activity */}
      {activity && (
        <Card className="mb-4">
          <CardHeader><CardTitle>Активность</CardTitle></CardHeader>
          <CardContent>
            <ActivityHeatmap data={activity} />
          </CardContent>
        </Card>
      )}

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
            {groupsLoading ? <p className="text-sm text-muted-foreground">Загрузка...</p>
              : myGroups.length === 0 ? <p className="text-sm text-muted-foreground">Вы ещё не вступили ни в одну группу</p>
              : myGroups.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-2 border border-border rounded-lg p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{g.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{g.school} · {g.city}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive shrink-0 text-xs"
                    onClick={() => leaveGroup.mutate(g.id)} loading={leaveGroup.isPending}>Выйти</Button>
                </div>
              ))
            }
            {canJoin && (
              <div className="flex flex-col gap-2 pt-1">
                <p className="text-xs text-muted-foreground">Введите код группы (школа или курсы)</p>
                <div className="flex gap-2">
                  <input className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary font-mono uppercase tracking-widest"
                    placeholder="ABC123" maxLength={8} value={inviteCode}
                    onChange={(e) => { setInviteCode(e.target.value); setJoinError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && inviteCode.trim()) joinGroup.mutate(); }} />
                  <Button size="sm" disabled={!inviteCode.trim()} loading={joinGroup.isPending} onClick={() => joinGroup.mutate()}>Вступить</Button>
                </div>
                {joinError && <p className="text-sm text-destructive">{joinError}</p>}
              </div>
            )}
            {!canJoin && <p className="text-xs text-muted-foreground text-center pt-1">Максимум 2 группы. Выйдите из одной, чтобы вступить в другую.</p>}
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
              disabled={newPassword.length < 6} onClick={() => setPassword.mutate()}>Сменить пароль</Button>
          </div>
        </CardContent>
      </Card>

      <Button variant="ghost" className="w-full text-destructive" onClick={() => { clearTokens(); logout(); router.push("/login"); }}>
        Выйти из аккаунта
      </Button>
    </div>
  );
}

