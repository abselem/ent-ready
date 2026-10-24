import { BookOpen, ChartNoAxesCombined, ClipboardCheck, GraduationCap } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh max-w-6xl flex-col justify-center gap-6 px-4 py-8 md:px-8 lg:grid lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-12">
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><GraduationCap className="size-6" /></span>
            <p className="text-xl font-semibold tracking-tight">ENT <span className="text-primary">Ready</span><span className="ml-1 text-teal-600 dark:text-teal-300">.</span></p>
          </div>
          <section className="mt-12 hidden max-w-md lg:block" aria-labelledby="auth-intro-title">
            <p className="mb-4 text-sm font-medium text-primary">Ваше учебное пространство</p>
            <h2 id="auth-intro-title" className="text-4xl font-semibold leading-tight tracking-tight">Подготовка к ЕНТ,<br />шаг за шагом</h2>
            <p className="mt-5 text-base leading-relaxed text-muted-foreground">Всё для занятий в одном месте. Выбирайте предмет, изучайте материал и возвращайтесь к своим результатам.</p>
            <ul className="mt-8 space-y-5">
              {[
                { Icon: ClipboardCheck, title: "Тесты и тренировки", text: "Практика по предметам и пробный ЕНТ" },
                { Icon: BookOpen, title: "Учебные материалы", text: "Уроки для подготовки к тестированию" },
                { Icon: ChartNoAxesCombined, title: "Результаты попыток", text: "Баллы и доступный разбор ответов" },
              ].map(({ Icon, title, text }) => <li key={title} className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-primary"><Icon aria-hidden="true" className="size-5" /></span><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{text}</p></div></li>)}
            </ul>
          </section>
        </div>
        <div className="mx-auto w-full max-w-md lg:justify-self-end">{children}</div>
      </div>
    </main>
  );
}
