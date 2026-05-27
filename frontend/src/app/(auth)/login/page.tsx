"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { api, saveTokens } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type Mode = "password" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();

  const [mode, setMode] = useState<Mode>("password");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSendOTP() {
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/send-otp", { phone, purpose: "login" });
      setOtpSent(true);
    } catch {
      setError("Не удалось отправить код. Проверьте номер телефона.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = mode === "password"
        ? await api.post("/auth/login", { phone, password })
        : await api.post("/auth/login/otp", { phone, code });

      saveTokens(data.access_token, data.refresh_token);
      setTokens(data.access_token, data.refresh_token);

      const { data: user } = await api.get("/users/me");
      setUser(user);

      router.push(user.role_id === 1 ? "/teacher" : "/student");
    } catch {
      setError("Неверные данные. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-3 mb-2">
            <Image src="/logo.png" alt="ENT Ready" width={40} height={40} className="rounded-xl" />
            <div>
              <p className="font-bold text-xl leading-tight">
                <span style={{ color: "#1B2A5C" }}>ENT </span>
                <span style={{ color: "#26C0BD" }}>Ready</span>
              </p>
              <p className="text-xs text-muted-foreground">Платформа для подготовки к ЕНТ</p>
            </div>
          </div>
          <CardTitle className="text-base">Вход в аккаунт</CardTitle>
          <CardContent className="p-0 mt-0.5 text-sm text-muted-foreground">
            Введите данные для входа
          </CardContent>
        </CardHeader>

        {/* Переключатель режима */}
        <div className="flex rounded-lg border border-border overflow-hidden mb-6">
          <button
            onClick={() => setMode("password")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === "password" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            Пароль
          </button>
          <button
            onClick={() => setMode("otp")}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === "otp" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            SMS-код
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="phone"
            label="Телефон"
            type="tel"
            placeholder="+79991234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />

          {mode === "password" && (
            <Input
              id="password"
              label="Пароль"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}

          {mode === "otp" && (
            <>
              {!otpSent ? (
                <Button type="button" variant="outline" loading={loading} onClick={handleSendOTP}>
                  Отправить код
                </Button>
              ) : (
                <Input
                  id="code"
                  label="Код из SMS"
                  type="text"
                  inputMode="numeric"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            size="lg"
            loading={loading}
            disabled={mode === "otp" && !otpSent}
            className="w-full"
          >
            Войти
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-4">
          Нет аккаунта?{" "}
          <Link href="/register" className="text-primary hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </Card>
    </div>
  );
}
