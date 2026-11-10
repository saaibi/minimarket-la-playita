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
export const nativeVault: SecretVault = {
  async get(key) {
    if (!Capacitor.isNativePlatform())
      throw Error("Native secure storage required");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        SecureStorage.getItem("playita_auth_" + key),
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
    if (!Capacitor.isNativePlatform())
      throw Error("Native secure storage required");
    await SecureStorage.set(
      "playita_auth_" + key,
      value,
      false,
      false,
      KeychainAccess.whenUnlockedThisDeviceOnly,
    );
  },
  async remove(key) {
    if (!Capacitor.isNativePlatform())
      throw Error("Native secure storage required");
    await SecureStorage.remove("playita_auth_" + key, false);
  },
};
