"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/card";

type Step = "email" | "code" | "details";

export default function RegisterPage() {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [roleId, setRoleId] = useState<1 | 2>(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const STEPS: Step[] = ["email", "code", "details"];
  const stepIndex = STEPS.indexOf(step);

  async function handleSendOTP() {
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/send-otp", { email: email.trim(), purpose: "register" });
      setStep("code");
      startResendCooldown();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
      if (msg.includes("уже зарегистрирован")) setError("Этот email уже зарегистрирован.");
      else setError("Не удалось отправить код. Проверьте email.");
    } finally {
      setLoading(false);
    }
  }

  function startResendCooldown() {
    setResendCooldown(60);
    const iv = setInterval(() => {
      setResendCooldown(n => {
        if (n <= 1) { clearInterval(iv); return 0; }
        return n - 1;
      });
    }, 1000);
  }

  function handleVerifyCode() {
    if (code.length < 4) { setError("Введите 4-значный код"); return; }
    setError("");
    setStep("details");
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== passwordConfirm) {
      setError("Пароли не совпадают");
      return;
    }
    if (password.length < 8) {
      setError("Пароль должен содержать минимум 8 символов");
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", {
        email: email.trim(),
        code,
        first_name: firstName,
        last_name: lastName,
        password,
        role_id: roleId,
      });
      setTokens(data.access_token, data.refresh_token);
      const { data: user } = await api.get("/users/me");
      setUser(user);
      router.push(user.role_id === 1 ? "/teacher" : "/student");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
      if (msg.includes("уже зарегистрирован") || msg.includes("already")) setError("Этот email уже зарегистрирован.");
      else if (msg.includes("Неверный код") || msg.includes("invalid code")) setError("Неверный код. Попробуйте снова.");
      else if (msg.includes("истёк") || msg.includes("expired")) { setError("Код истёк. Запросите новый."); setStep("email"); }
      else setError("Ошибка регистрации. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Card className="w-full p-6 md:p-8" aria-busy={loading}>
        <CardHeader className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Создать аккаунт</h1>
          <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
            {step === "email" && "Начните с email — отправим код подтверждения."}
            {step === "code" && "Подтвердите email с помощью кода из письма."}
            {step === "details" && "Выберите роль и заполните данные профиля."}
          </p>
        </CardHeader>

        {/* Progress bar */}
        <div role="progressbar" aria-label="Этап регистрации" aria-valuemin={1} aria-valuemax={3} aria-valuenow={stepIndex + 1} aria-valuetext={`Шаг ${stepIndex + 1} из 3`} className="flex gap-1 mb-6">
          {STEPS.map((s, i) => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${
              stepIndex >= i ? "bg-primary" : "bg-muted"
            }`} />
          ))}
        </div>

        {/* Step 1: Email */}
        {step === "email" && (
          <div className="flex flex-col gap-4">
            <Input
              id="email" label="Email" type="email"
              placeholder="example@mail.com"
              value={email} onChange={e => { setEmail(e.target.value); setError(""); }}
              autoComplete="email"
            />
            {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive">{error}</p>}
            <Button
              size="lg" loading={loading} onClick={handleSendOTP}
              disabled={!email.trim()} className="w-full"
            >
              Получить код
            </Button>
          </div>
        )}

        {/* Step 2: OTP code */}
        {step === "code" && (
          <div className="flex flex-col gap-4">
            <div role="status" className="break-words bg-muted/50 rounded-xl p-3 text-sm text-muted-foreground">
              Мы отправили 4-значный код на <span className="text-foreground font-medium">{email}</span>
            </div>
            <Input
              id="code" label="Код из письма" type="text"
              inputMode="numeric" placeholder="1234" maxLength={4}
              value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
              autoComplete="one-time-code"
            />
            {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive">{error}</p>}
            <Button size="lg" onClick={handleVerifyCode} disabled={code.length < 4} className="w-full">
              Продолжить
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <button onClick={() => { setStep("email"); setCode(""); setError(""); }}
                className="min-h-11 text-muted-foreground hover:text-foreground">
                ← Изменить email
              </button>
              {resendCooldown > 0 ? (
                <span className="text-muted-foreground">Повтор через {resendCooldown}с</span>
              ) : (
                <button onClick={handleSendOTP} disabled={loading}
                  className="min-h-11 text-primary hover:underline disabled:opacity-50">
                  Отправить снова
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Details */}
        {step === "details" && (
          <form onSubmit={handleRegister} className="flex flex-col gap-3">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button type="button" aria-pressed={roleId === 2} onClick={() => setRoleId(2)}
                className={`min-h-11 flex-1 px-2 py-2 text-sm font-medium transition-colors ${roleId === 2 ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                Ученик
              </button>
              <button type="button" aria-pressed={roleId === 1} onClick={() => setRoleId(1)}
                className={`min-h-11 flex-1 px-2 py-2 text-sm font-medium transition-colors ${roleId === 1 ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
                Учитель
              </button>
            </div>
            <Input id="firstName" label="Имя" placeholder="Азамат"
              value={firstName} onChange={e => setFirstName(e.target.value)} required />
            <Input id="lastName" label="Фамилия" placeholder="Азаматов"
              value={lastName} onChange={e => setLastName(e.target.value)} required />
            <Input id="password" label="Пароль" type="password" placeholder="Минимум 8 символов"
              value={password} onChange={e => setPassword(e.target.value)} required />
            <Input id="passwordConfirm" label="Повторите пароль" type="password" placeholder="••••••••"
              value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} required />
            {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive-surface p-3 text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" loading={loading} className="w-full"
              disabled={!firstName.trim() || !lastName.trim() || !password || !passwordConfirm}>
              Зарегистрироваться
            </Button>
            <button type="button" onClick={() => { setStep("code"); setError(""); }}
              className="min-h-11 text-sm text-muted-foreground hover:text-foreground">
              ← Назад
            </button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground mt-4">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="inline-flex min-h-11 items-center text-primary hover:underline">Войти</Link>
        </p>
      </Card>
    </div>
  );
}
