"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

export type QaSchoolContext = { is_qa: false } | {
  is_qa: true;
  active: boolean;
  organization_id: number;
  organization_name: string;
  group_id: number;
  group_name: string;
  role: "owner" | "admin" | "teacher" | "student" | "";
};

export function useQaSchool() {
  const { user, sessionVersion, accessToken } = useAuthStore();
  return useQuery({
    queryKey: ["qa-school", user?.id, sessionVersion],
    queryFn: async () => (await api.get<QaSchoolContext>("/qa/context")).data,
    enabled: Boolean(user && accessToken),
    retry: false,
    staleTime: 30_000,
  });
}
