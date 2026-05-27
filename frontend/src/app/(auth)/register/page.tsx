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

type Step = "phone" | "code" | "details";

export default function RegisterPage() {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();

  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [roleId, setRoleId] = useState<2 | 1>(2); // 2=студент, 1=учитель
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSendOTP() {
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/send-otp", { phone, purpose: "register" });
      setStep("code");
    } catch {
      setError("Не удалось отправить код. Проверьте номер телефона.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    if (code.length < 4) {
      setError("Введите код из SMS");
      return;
    }
    setStep("details");
    setError("");
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", {
        phone,
        code,
        first_name: firstName,
        last_name: lastName,
        password,
        role_id: roleId,
      });

      saveTokens(data.access_token, data.refresh_token);
      setTokens(data.access_token, data.refresh_token);

      const { data: user } = await api.get("/users/me");
      setUser(user);

      router.push(user.role_id === 1 ? "/teacher" : "/student");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "";
      if (msg.includes("expired") || msg.includes("invalid or expired")) {
        setError("Код истёк. Вернитесь назад и запросите новый.");
      } else if (msg.includes("too many")) {
        setError("Слишком много попыток. Запросите новый код.");
      } else if (msg.includes("invalid code")) {
        setError("Неверный код. Проверьте SMS.");
      } else if (msg.includes("already exists")) {
        setError("Этот номер уже зарегистрирован.");
      } else {
        setError("Ошибка регистрации. Попробуйте ещё раз.");
      }
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
          <CardTitle className="text-base">Регистрация</CardTitle>
          <CardContent className="p-0 mt-0.5 text-sm text-muted-foreground">
            {step === "phone" && "Введите номер телефона"}
            {step === "code" && "Введите код из SMS"}
            {step === "details" && "Заполните данные профиля"}
          </CardContent>
        </CardHeader>

        {/* Step indicator */}
        <div className="flex gap-1 mb-6">
          {(["phone", "code", "details"] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors ${
                ["phone", "code", "details"].indexOf(step) >= i
                  ? "bg-primary"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>

        {step === "phone" && (
          <div className="flex flex-col gap-4">
            <Input
              id="phone"
              label="Телефон"
              type="tel"
              placeholder="+77771234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button size="lg" loading={loading} onClick={handleSendOTP} className="w-full">
              Отправить код
            </Button>
          </div>
        )}

        {step === "code" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Код отправлен на {phone}
            </p>
            <Input
              id="code"
              label="Код из SMS"
              type="text"
              inputMode="numeric"
              placeholder="123456"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button size="lg" loading={loading} onClick={handleVerifyCode} className="w-full">
              Продолжить
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setStep("phone"); setError(""); }}
            >
              Изменить номер
            </Button>
          </div>
        )}

        {step === "details" && (
          <form onSubmit={handleRegister} className="flex flex-col gap-4">
            {/* Выбор роли */}
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Я регистрируюсь как</span>
              <div className="flex rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setRoleId(2)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    roleId === 2 ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                  }`}
                >
                  Ученик
                </button>
                <button
                  type="button"
                  onClick={() => setRoleId(1)}
                  className={`flex-1 py-2 text-sm font-medium transition-colors ${
                    roleId === 1 ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"
                  }`}
                >
                  Учитель
                </button>
              </div>
            </div>

            <Input
              id="firstName"
              label="Имя"
              placeholder="Иван"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <Input
              id="lastName"
              label="Фамилия"
              placeholder="Иванов"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
            <Input
              id="password"
              label="Пароль"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <Button type="submit" size="lg" loading={loading} className="w-full">
              Зарегистрироваться
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setStep("phone"); setCode(""); setError(""); }}
            >
              ← Запросить новый код
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground mt-4">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="text-primary hover:underline">
            Войти
          </Link>
        </p>
      </Card>
    </div>
  );
}
