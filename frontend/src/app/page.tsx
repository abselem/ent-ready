"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";

export default function RootPage() {
  const router = useRouter();
  const { user, accessToken } = useAuthStore();

  useEffect(() => {
    if (!accessToken) {
      router.replace("/login");
      return;
    }
    router.replace(user?.role_id === 1 ? "/teacher" : "/student");
  }, [accessToken, user, router]);

  return null;
}
