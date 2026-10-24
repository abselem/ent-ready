"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clearAuthQueries } from "@/lib/auth-query-cache";

export type Role = "teacher" | "student" | "self_learning";

interface User {
  id: number;
  phone: string | null;
  first_name: string;
  last_name: string;
  role_id: number;
  role?: Role;
  profile_subject1?: number | null;
  profile_subject2?: number | null;
  avatar_url?: string | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  _hasHydrated: boolean;
  sessionVersion: number;
  setTokens: (access: string, refresh: string) => void;
  rotateTokens: (access: string, refresh: string) => void;
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
      sessionVersion: 0,

      setTokens(access, refresh) {
        clearAuthQueries();
        set({ user: null, accessToken: access, refreshToken: refresh, sessionVersion: get().sessionVersion + 1 });
        localStorage.setItem("access_token", access);
        localStorage.setItem("refresh_token", refresh);
      },

      rotateTokens(access, refresh) {
        set({ accessToken: access, refreshToken: refresh });
        localStorage.setItem("access_token", access);
        localStorage.setItem("refresh_token", refresh);
      },

      setUser(user) {
        const changed = get().user?.id !== user.id;
        if (changed) clearAuthQueries();
        set({ user, sessionVersion: get().sessionVersion + (changed ? 1 : 0) });
      },

      logout() {
        clearAuthQueries();
        set({ user: null, accessToken: null, refreshToken: null, sessionVersion: get().sessionVersion + 1 });
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
      },

      isTeacher: () => get().user?.role_id === 1,
      isStudent: () => get().user?.role_id === 2,
    }),
    {
      name: "auth",
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken, refreshToken: state.refreshToken }),
      onRehydrateStorage: () => (state) => {
        if (state) state._hasHydrated = true;
      },
    }
  )
);
