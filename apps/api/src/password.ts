import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, options, (e, key) =>
      e ? reject(e) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16),
    key = await derive(password, salt);
  return `scrypt$131072$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, saltHex, keyHex] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    n !== "131072" ||
    r !== "8" ||
    p !== "1" ||
    !saltHex ||
    !keyHex ||
    !/^[a-f0-9]{32}$/.test(saltHex) ||
    !/^[a-f0-9]{128}$/.test(keyHex)
  )
    return false;
  const key = await derive(password, Buffer.from(saltHex, "hex"));
  return timingSafeEqual(key, Buffer.from(keyHex, "hex"));
}
