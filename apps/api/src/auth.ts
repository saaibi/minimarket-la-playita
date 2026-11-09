import { jwtVerify } from "jose";
import { roleSchema, type Actor } from "@playita/shared";
export async function authenticate(
  header: string | undefined,
  secret: string,
): Promise<Actor> {
  if (!header?.startsWith("Bearer ")) throw Error("TOKEN_REQUIRED");
  const { payload } = await jwtVerify(
    header.slice(7),
    new TextEncoder().encode(secret),
    { algorithms: ["HS256"], issuer: "playita-local", audience: "playita-api" },
  );
  if (!payload.sub) throw Error("INVALID_SUBJECT");
  return { id: payload.sub, role: roleSchema.parse(payload.role) };
}
