import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "co.laplayita.minimarket",
  appName: "Minimarket La Playita",
  webDir: "dist",
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
  },
};
export default config;
