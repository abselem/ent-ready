import type { ReactNode } from "react";

export function PageHeader({ title, description, eyebrow, action }: { title: string; description?: string; eyebrow?: string; action?: ReactNode }) {
  return <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
    <div className="min-w-0 max-w-2xl">
      {eyebrow && <p className="mb-2 text-xs font-semibold tracking-[.12em] text-muted-foreground uppercase">{eyebrow}</p>}
      <h1 className="text-2xl leading-tight font-semibold tracking-tight md:text-[28px]">{title}</h1>
      {description && <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-base">{description}</p>}
    </div>
    {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
  </header>;
}
