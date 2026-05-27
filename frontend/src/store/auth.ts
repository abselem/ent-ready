"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "teacher" | "student" | "self_learning";

interface User {
  id: number;
  phone: string;
  first_name: string;
  last_name: string;
  role_id: number;
  role?: Role;
  profile_subject1?: number | null;
  profile_subject2?: number | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  _hasHydrated: boolean;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
  isTeacher: () => boolean;
  isStudent: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      _hasHydrated: false,

      setTokens(access, refresh) {
        set({ accessToken: access, refreshToken: refresh });
        localStorage.setItem("access_token", access);
        localStorage.setItem("refresh_token", refresh);
      },

      setUser(user) {
        set({ user });
      },

      logout() {
        set({ user: null, accessToken: null, refreshToken: null });
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
      },

      isTeacher: () => get().user?.role_id === 1,
      isStudent: () => get().user?.role_id === 2,
    }),
    {
      name: "auth",
      onRehydrateStorage: () => (state) => {
        if (state) state._hasHydrated = true;
      },
    }
  )
);
