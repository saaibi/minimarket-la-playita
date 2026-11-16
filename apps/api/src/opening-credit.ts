import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
export const openingBalanceSchema = z
  .object({
    amountCop: z.number().int().positive().max(2000000000),
    note: z.string().trim().min(3).max(300),
  })
  .strict();
export class OpeningCreditError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export async function recordOpeningCredit(
  db: PoolClient,
  actorId: string,
  clientId: string,
  enabled: boolean,
  input: z.infer<typeof openingBalanceSchema> | undefined,
) {
  if (!input) return;
  if (!enabled) throw new OpeningCreditError("CREDIT_DISABLED");
  const existing = (
    await db.query("SELECT * FROM credit_openings WHERE client_id=$1", [
      clientId,
    ])
  ).rows[0];
  if (existing) {
    if (
      existing.amount_cop === input.amountCop &&
      existing.reason === input.note
    )
      return;
    throw new OpeningCreditError("OPENING_ALREADY_RECORDED");
  }
  const id = randomUUID();
  await db.query(
    "INSERT INTO credit_openings(id,client_id,amount_cop,reason,actor_id) VALUES($1,$2,$3,$4,$5)",
    [id, clientId, input.amountCop, input.note, actorId],
  );
  await db.query(
    "INSERT INTO inventory_audit(actor_id,kind,entity_id,before_data,after_data,reason) VALUES($1,'credit.opening',$2,NULL,$3,$4)",
    [
      actorId,
      id,
      JSON.stringify({ clientId, amountCop: input.amountCop }),
      input.note,
    ],
  );
  await db.query(
    "INSERT INTO events(kind,payload) VALUES('credit.updated',$1)",
    [JSON.stringify({ clientId })],
  );
}
export async function openingDebt(db: PoolClient, clientId: string) {
  const row = (
    await db.query(
      "SELECT o.*,o.amount_cop-COALESCE((SELECT SUM(p.amount_cop) FROM credit_opening_payments p WHERE p.opening_id=o.id),0) AS balance FROM credit_openings o WHERE o.client_id=$1",
      [clientId],
    )
  ).rows[0];
  return row ? { ...row, balance: Number(row.balance) } : null;
}
