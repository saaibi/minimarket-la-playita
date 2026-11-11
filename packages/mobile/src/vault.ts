import { Capacitor } from "@capacitor/core";
import {
  SecureStorage,
  KeychainAccess,
} from "@aparajita/capacitor-secure-storage";
export interface SecretVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export function createNativeVault(
  storage: Pick<typeof SecureStorage, "get" | "set" | "remove"> = SecureStorage,
  isNative: () => boolean = () => Capacitor.isNativePlatform(),
): SecretVault {
  return {
    async get(key) {
      if (!isNative()) throw Error("Native secure storage required");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          storage.get("playita_auth_" + key, false, false).then((value) => {
            if (value !== null && typeof value !== "string")
              throw Error("NATIVE_STORAGE_INVALID");
            return value;
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("NATIVE_STORAGE_TIMEOUT")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async set(key, value) {
      if (!isNative()) throw Error("Native secure storage required");
      await storage.set(
        "playita_auth_" + key,
        value,
        false,
        false,
        KeychainAccess.whenUnlockedThisDeviceOnly,
      );
    },
    async remove(key) {
      if (!isNative()) throw Error("Native secure storage required");
      await storage.remove("playita_auth_" + key, false);
    },
  };
}
export const nativeVault = createNativeVault();
