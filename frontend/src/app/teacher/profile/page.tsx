"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { clearTokens } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default function TeacherProfilePage() {
  const router = useRouter();
  const { user, setUser, logout } = useAuthStore();

  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const updateProfile = useMutation({
    mutationFn: () => api.patch("/users/me", { first_name: firstName, last_name: lastName }),
    onSuccess: async () => {
      const { data } = await api.get("/users/me");
      setUser(data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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

  function handleLogout() {
    clearTokens();
    logout();
    router.push("/login");
  }

  return (
    <div className="p-4 md:p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-6">Профиль</h1>

      <Card className="mb-4">
        <CardHeader><CardTitle>Личные данные</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Input
              id="phone"
              label="Телефон"
              value={user?.phone ?? ""}
              disabled
            />
            <Input
              id="firstName"
              label="Имя"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <Input
              id="lastName"
              label="Фамилия"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            {saved && <p className="text-sm text-green-600">Сохранено!</p>}
            <Button loading={updateProfile.isPending} onClick={() => updateProfile.mutate()}>
              Сохранить
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader><CardTitle>Сменить пароль</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Input
              id="password"
              label="Новый пароль"
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Button
              variant="outline"
              loading={setPassword.isPending}
              disabled={newPassword.length < 6}
              onClick={() => setPassword.mutate()}
            >
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
