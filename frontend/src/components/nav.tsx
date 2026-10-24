"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, LogOut } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { apiOrigin, signOut } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface NavItem { href: string; label: string; icon: React.ReactNode }
interface NavProps { items: NavItem[] }

export function Nav({ items }: NavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const active = (href: string) => pathname === href || (href !== "/teacher" && href !== "/student" && pathname.startsWith(`${href}/`));
  const raw = typeof user?.avatar_url === "string" ? user.avatar_url : null;
  const avatar = raw ? (raw.startsWith("/static/") ? `${apiOrigin}${raw}` : raw) : null;
  const initials = `${user?.first_name?.[0] ?? ""}${user?.last_name?.[0] ?? ""}`.toUpperCase();
  const teacher = user?.role_id === 1;

  function confirmLeave() {
    return document.body.dataset.activeAttempt !== "true" || window.confirm("Выйти из теста? Вернуться к этой обычной попытке после перехода пока нельзя. Уже отправленные ответы останутся на сервере.");
  }
  function guardNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.currentTarget.pathname === pathname) return;
    if (!confirmLeave()) event.preventDefault();
  }
  async function handleLogout() { if (!confirmLeave()) return; await signOut(); router.push("/login"); }

  return <>
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-card focus:p-3">К содержимому</a>
    <aside className="hidden h-full w-56 shrink-0 flex-col border-r border-border bg-card md:flex">
      <Link href={teacher ? "/teacher" : "/student"} onClick={guardNavigation} className="mx-5 mt-7 mb-8 flex min-h-11 items-center gap-2.5 rounded-lg" aria-label="ENT Ready — главная">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-primary"><Check aria-hidden="true" className="size-6" strokeWidth={2.5} /></span>
        <span className="text-lg font-semibold tracking-tight text-foreground">ENT <span className="text-primary">Ready</span></span>
      </Link>
      <p className="mb-3 px-6 text-[11px] font-semibold tracking-[.12em] text-muted-foreground uppercase">{teacher ? "Пространство учителя" : "Моя подготовка"}</p>
      <nav aria-label="Основная навигация" className="flex flex-1 flex-col gap-1 px-3">
        {items.map((item) => <Link key={item.href} href={item.href} onClick={guardNavigation} aria-current={active(item.href) ? "page" : undefined}
          className={cn("flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors", active(item.href) ? "bg-accent font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
          <span aria-hidden="true" className="size-[18px] shrink-0">{item.icon}</span><span>{item.label}</span>
        </Link>)}
      </nav>
      <div className="mx-4 mt-6 border-t border-border py-5">
        <div className="flex items-center gap-2.5 px-1">
          {avatar ? <img src={avatar} alt="" className="size-9 rounded-full object-cover" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">{initials}</span>}
          <div className="min-w-0"><p className="truncate text-sm font-medium">{user?.first_name} {user?.last_name}</p><p className="text-xs text-muted-foreground">{teacher ? "Учитель" : "Ученик"}</p></div>
        </div>
        <button onClick={handleLogout} className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut aria-hidden="true" className="size-4" />Выйти</button>
      </div>
    </aside>
    <nav aria-label="Основная навигация на телефоне" className="fixed right-0 bottom-0 left-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map((item) => <Link key={item.href} href={item.href} onClick={guardNavigation} aria-current={active(item.href) ? "page" : undefined}
        className={cn("flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] leading-tight", active(item.href) ? "bg-accent font-semibold text-primary" : "text-muted-foreground")}>
        <span aria-hidden="true" className="size-5 shrink-0">{item.icon}</span><span className="max-w-full">{item.label}</span>
      </Link>)}
    </nav>
  </>;
}
