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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  function startResendCooldown() {
    setResendCooldown(60);
    const iv = setInterval(() => {
      setResendCooldown(n => {
        if (n <= 1) { clearInterval(iv); return 0; }
        return n - 1;
      });
    }, 1000);
  }

  async function handleSendOTP() {
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/send-otp", { email: email.trim(), purpose: "login" });
      setOtpSent(true);
      startResendCooldown();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
      if (msg.includes("не найден")) setError("Пользователь с таким email не найден.");
      else setError("Не удалось отправить код. Проверьте email.");
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
        ? await api.post("/auth/login", { email: email.trim(), password })
        : await api.post("/auth/login/otp", { email: email.trim(), code });

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
                <span style={{ color: "#ffffff" }}>ENT </span>
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

        {/* Mode switcher */}
        <div className="flex rounded-lg border border-border overflow-hidden mb-5">
          <button onClick={() => { setMode("password"); setError(""); setOtpSent(false); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === "password" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
            Пароль
          </button>
          <button onClick={() => { setMode("otp"); setError(""); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${mode === "otp" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
            Код на email
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="email" label="Email" type="email"
            placeholder="example@mail.com"
            value={email} onChange={e => { setEmail(e.target.value); setError(""); }}
            autoComplete="email"
          />

          {mode === "password" && (
            <Input
              id="password" label="Пароль" type="password"
              placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              required autoComplete="current-password"
            />
          )}

          {mode === "otp" && (
            <>
              {!otpSent ? (
                <Button type="button" variant="outline" loading={loading}
                  onClick={handleSendOTP} disabled={!email.trim()}>
                  Отправить код на email
                </Button>
              ) : (
                <>
                  <div className="bg-muted/50 rounded-xl p-3 text-sm text-muted-foreground">
                    Код отправлен на <span className="text-foreground font-medium">{email}</span>
                  </div>
                  <Input
                    id="code" label="Код из письма" type="text"
                    inputMode="numeric" placeholder="1234" maxLength={4}
                    value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                    autoComplete="one-time-code"
                  />
                  <div className="flex items-center justify-between text-sm">
                    <button type="button" onClick={() => { setOtpSent(false); setCode(""); }}
                      className="text-muted-foreground hover:text-foreground">
                      ← Изменить email
                    </button>
                    {resendCooldown > 0 ? (
                      <span className="text-muted-foreground">Повтор через {resendCooldown}с</span>
                    ) : (
                      <button type="button" onClick={handleSendOTP} disabled={loading}
                        className="text-primary hover:underline disabled:opacity-50">
                        Отправить снова
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit" size="lg" loading={loading} className="w-full"
            disabled={mode === "otp" && !otpSent}
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
