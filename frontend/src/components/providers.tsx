"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/auth";
import { registerAuthQueryClient } from "@/lib/auth-query-cache";

export function Providers({ children }: { children: React.ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id);
  const sessionVersion = useAuthStore((state) => state.sessionVersion);

  // Remount both the cache and local page state when the identity changes.
  return <SessionQueries key={`${sessionVersion}:${userId ?? "anonymous"}`}>{children}</SessionQueries>;
}

function SessionQueries({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }));

  useEffect(() => registerAuthQueryClient(client), [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
