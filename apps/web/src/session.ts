import { useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { SessionClient, nativeVault } from "@playita/mobile";
export const native = Capacitor.isNativePlatform();
export const base = import.meta.env?.VITE_API_URL || "http://127.0.0.1:4300";
let logoutPending = false;
export const auth = new SessionClient({
  base,
  mode: native ? "native" : "web",
  ...(native ? { vault: nativeVault } : {}),
  csrf: () =>
    document.cookie
      .split("; ")
      .find((x) => x.startsWith("playita_csrf="))
      ?.split("=")[1] || "",
  lock: async (fn) => {
    if (!native && navigator.locks)
      return await navigator.locks.request(
        "playita-refresh",
        async () => await fn(),
      );
    return await fn();
  },
  intent: native
    ? undefined
    : {
        get: () => {
          try {
            return (
              logoutPending ||
              sessionStorage.getItem("playita-logout-pending") === "true"
            );
          } catch {
            return logoutPending;
          }
        },
        set: (value) => {
          logoutPending = value;
          try {
            if (value) sessionStorage.setItem("playita-logout-pending", "true");
            else sessionStorage.removeItem("playita-logout-pending");
          } catch {}
        },
      },
});
export function useSession() {
  return useSyncExternalStore(
    auth.subscribe,
    () => auth.current,
    () => null,
  );
}
