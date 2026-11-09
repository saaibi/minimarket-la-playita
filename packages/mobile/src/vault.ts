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
    return SecureStorage.getItem("playita_auth_" + key);
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
