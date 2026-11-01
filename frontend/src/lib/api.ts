import axios from "axios";
import type { InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/store/auth";

type SessionRequest = InternalAxiosRequestConfig & { _retry?: boolean; _session?: number };
let refreshRequest: { session: number; promise: Promise<{ access_token: string; refresh_token: string }> } | undefined;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080/api/v1";

export const api = axios.create({ baseURL: API_URL, timeout: 60_000 });

// API session handling.
export const apiOrigin = API_URL.replace(/\/api\/v1\/?$/, "");

// API session handling.
api.interceptors.request.use((config) => {
  const request = config as SessionRequest;
  const state = useAuthStore.getState();
  if (request._session !== undefined && request._session !== state.sessionVersion) {
    throw new axios.CanceledError("Session changed");
  }
  request._session = state.sessionVersion;
  const token = state.accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// API session handling.
api.interceptors.response.use(
  (r) => {
    if ((r.config as SessionRequest)._session !== useAuthStore.getState().sessionVersion) {
      throw new axios.CanceledError("Session changed");
    }
    return r;
  },
  async (error) => {
    const original = error.config as SessionRequest | undefined;
    if (!original) return Promise.reject(error);
    const session = original._session;
    if (session === undefined || session !== useAuthStore.getState().sessionVersion) {
      return Promise.reject(new axios.CanceledError("Session changed"));
    }
    // Invalid login/OTP credentials belong to the form, not session recovery.
    const path = original.url?.split("?")[0] ?? "";
    if (path === "/users/me/password" && error.response?.data?.error === "current password required; use email reset if no password is set") {
      return Promise.reject(error);
    }
    if (/^\/?auth\/(login(?:\/otp)?|register|send-otp|reset-password)\/?$/.test(path)) {
      return Promise.reject(error);
    }
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = useAuthStore.getState().refreshToken;
      if (!refresh) {
        clearTokens();
        window.location.href = "/login";
        return Promise.reject(error);
      }
      try {
        if (!refreshRequest || refreshRequest.session !== session) {
          const promise = axios.post(
            `${API_URL}/auth/refresh`,
            { refresh_token: refresh },
            { timeout: 15_000 }
          ).then(({ data }) => data);
          refreshRequest = { session, promise };
          void promise.finally(() => {
            if (refreshRequest?.promise === promise) refreshRequest = undefined;
          }).catch(() => {});
        }
        const data = await refreshRequest.promise;
        if (session !== useAuthStore.getState().sessionVersion) {
          return Promise.reject(new axios.CanceledError("Session changed"));
        }
        saveTokens(data.access_token, data.refresh_token);
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return api(original);
      } catch {
        if (session !== useAuthStore.getState().sessionVersion) {
          return Promise.reject(new axios.CanceledError("Session changed"));
        }
        clearTokens();
        window.location.href = "/login";
        return Promise.reject(error);
      }
    }
    if (error.response?.status === 401) {
      clearTokens();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export function saveTokens(access: string, refresh: string) {
  useAuthStore.getState().rotateTokens(access, refresh);
}

export function clearTokens() {
  useAuthStore.getState().logout();
}

// Offline logout clears this browser; server revocation requires a successful request.
export async function signOut() {
  const session = useAuthStore.getState().sessionVersion;
  try {
    if (useAuthStore.getState().accessToken) {
      await api.post("/auth/logout", undefined, { timeout: 5_000 });
    }
  } catch {
    // Keep local logout available when the server cannot be reached.
  } finally {
    if (useAuthStore.getState().sessionVersion === session) clearTokens();
  }
}
