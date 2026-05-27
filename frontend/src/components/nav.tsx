"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
import { clearTokens } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavProps {
  items: NavItem[];
}

function Logo() {
  return (
    <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 shrink-0">
      <rect x="6" y="6" width="88" height="88" rx="22" stroke="#26C0BD" strokeWidth="9" strokeLinecap="round"/>
      <path d="M24 52 L42 70 L76 32" stroke="#26C0BD" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function Nav({ items }: NavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  function handleLogout() {
    clearTokens();
    logout();
    router.push("/login");
  }

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-card h-full">
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="min-w-0">
              <p className="font-bold text-base leading-tight whitespace-nowrap">
                <span style={{ color: "#1B2A5C" }}>ENT </span>
                <span style={{ color: "#26C0BD" }}>Ready</span>
              </p>
              {user && (
                <p className="text-xs text-muted-foreground truncate leading-tight mt-0.5">
                  {user.first_name} {user.last_name}
                </p>
              )}
            </div>
          </div>
        </div>

        <nav className="flex-1 py-4 px-2 flex flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== "/teacher" && item.href !== "/student" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <span className="w-4 h-4 shrink-0">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-border">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Выйти
          </button>
        </div>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border flex">
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== "/teacher" && item.href !== "/student" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground"
              )}
            >
              <span className="w-5 h-5">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
