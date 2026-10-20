import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import { ApiError, get, post } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  error: unknown;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await get<User>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
  const logout = async () => {
    await post("/auth/logout");
    qc.clear();
    qc.setQueryData(["me"], null);
  };
  return (
    <AuthContext.Provider value={{ user: me.data ?? null, loading: me.isPending, error: me.error, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
