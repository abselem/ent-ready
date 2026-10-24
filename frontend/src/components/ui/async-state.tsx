"use client";

import { Button } from "@/components/ui/button";
import { CircleAlert, Inbox, LoaderCircle } from "lucide-react";
export function AsyncState({ title, description, onRetry, kind = "empty" }: { title: string; description?: string; onRetry?: () => void; kind?: "loading" | "error" | "empty" }) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "error" ? CircleAlert : Inbox;
  return <div role={kind === "error" ? "alert" : "status"} className="surface flex flex-col items-center px-5 py-10 text-center">
    <Icon aria-hidden="true" className={`mb-3 size-6 text-muted-foreground ${kind === "loading" ? "animate-spin" : ""}`} />
    <p className="font-medium text-foreground">{title}</p>
    {description && <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>}
    {onRetry && <Button className="mt-5" variant="outline" onClick={onRetry}>Повторить</Button>}
  </div>;
}
