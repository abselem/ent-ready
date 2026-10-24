"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/card";

type Mode = "password" | "otp";

function isEmail(s: string) {
  return s.includes("@");
}

export default function LoginPage() {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();

  const [mode, setMode] = useState<Mode>("password");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const identifierIsEmail = isEmail(identifier.trim());

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
      await api.post("/auth/send-otp", { email: identifier.trim().toLowerCase(), purpose: "login" });
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
        ? await api.post("/auth/login", { identifier: identifier.trim(), password })
        : await api.post("/auth/login/otp", { email: identifier.trim().toLowerCase(), code });

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
    <div>
      <Card className="w-full p-6 md:p-8" aria-busy={loading}>
        <CardHeader className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">С возвращением</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Войдите в аккаунт, чтобы продолжить подготовку.</p>
        </CardHeader>

        {/* Mode switcher — только для email */}
        {identifierIsEmail && (
          <div className="flex rounded-lg border border-border overflow-hidden mb-5">
            <button type="button" aria-pressed={mode === "password"} onClick={() => { setMode("password"); setError(""); setOtpSent(false); }}
              className={`min-h-11 flex-1 px-2 py-2 text-sm font-medium transition-colors ${mode === "password" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
              Пароль
            </button>
            <button type="button" aria-pressed={mode === "otp"} onClick={() => { setMode("otp"); setError(""); }}
              className={`min-h-11 flex-1 px-2 py-2 text-sm font-medium transition-colors ${mode === "otp" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
              Код на email
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="identifier" label="Email или номер телефона"
            type="text" placeholder="+7 777 123 45 67 или email@mail.com"
            value={identifier}
            onChange={e => {
              setIdentifier(e.target.value);
              setError("");
              setOtpSent(false);
              if (!isEmail(e.target.value)) setMode("password");
            }}
            autoComplete="username"
          />

          {(mode === "password" || !identifierIsEmail) && (
            <Input
              id="password" label="Пароль" type="password"
              placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              required autoComplete="current-password"
            />
          )}

          {mode === "otp" && identifierIsEmail && (
            <>
              {!otpSent ? (
                <Button type="button" variant="outline" loading={loading}
                  onClick={handleSendOTP} disabled={!identifier.trim()}>
                  Отправить код на email
                </Button>
              ) : (
                <>
                  <div role="status" className="break-words bg-muted/50 rounded-xl p-3 text-sm text-muted-foreground">
                    Код отправлен на <span className="text-foreground font-medium">{identifier}</span>
                  </div>
                  <Input
                    id="code" label="Код из письма" type="text"
                    inputMode="numeric" placeholder="1234" maxLength={4}
                    value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                    autoComplete="one-time-code"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <button type="button" onClick={() => { setOtpSent(false); setCode(""); }}
                      className="min-h-11 text-muted-foreground hover:text-foreground">
                      ← Изменить email
                    </button>
                    {resendCooldown > 0 ? (
                      <span className="text-muted-foreground">Повтор через {resendCooldown}с</span>
                    ) : (
                      <button type="button" onClick={handleSendOTP} disabled={loading}
                        className="min-h-11 text-primary hover:underline disabled:opacity-50">
                        Отправить снова
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive">{error}</p>}

          <Button
            type="submit" size="lg" loading={loading} className="w-full"
            disabled={mode === "otp" && identifierIsEmail && !otpSent}
          >
            Войти
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-4">
          Нет аккаунта?{" "}
          <Link href="/register" className="inline-flex min-h-11 items-center text-primary hover:underline">
            Зарегистрироваться
          </Link>
        </p>
      </Card>
    </div>
  );
}
