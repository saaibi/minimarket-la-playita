import type { Pool } from "pg";
export function reportRange(from: unknown, to: unknown) {
  const valid = (v: unknown): v is string =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (!valid(from) || !valid(to)) return null;
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  return days >= 0 && days < 366 ? { from, to } : null;
}
export async function businessReport(pool: Pool, from: string, to: string) {
  const { rows } = await pool.query(
    `WITH bounds AS (
 SELECT ($1::date::timestamp AT TIME ZONE 'America/Bogota') start_at, (($2::date+1)::timestamp AT TIME ZONE 'America/Bogota') end_at
 ), sales AS (
 SELECT o.*, EXISTS(SELECT 1 FROM credit_sales cs WHERE cs.order_id=o.id) credit,
 COALESCE((SELECT SUM(p.amount_cop) FROM credit_payments p WHERE p.order_id=o.id AND p.created_at=o.created_at),0) initial_paid
 FROM orders o,bounds b WHERE o.status='delivered' AND NOT o.sale_removed AND o.created_at>=b.start_at AND o.created_at<b.end_at AND (o.payment_status='paid' OR EXISTS(SELECT 1 FROM credit_sales cs WHERE cs.order_id=o.id))
 ), daily AS (
 SELECT (created_at AT TIME ZONE 'America/Bogota')::date day,SUM(total_cop) total,
 SUM(CASE WHEN credit THEN initial_paid ELSE total_cop END) cash,
 SUM(CASE WHEN credit THEN total_cop-initial_paid ELSE 0 END) credit
 FROM sales GROUP BY 1
 ), tops AS (
 SELECT l.product_id,MAX(l.product_name) name,SUM(l.total_cop) total FROM order_lines l JOIN sales s ON s.id=l.order_id GROUP BY l.product_id ORDER BY total DESC,l.product_id LIMIT 10
 ), debt AS (
 SELECT COALESCE(SUM(o.total_cop-COALESCE((SELECT SUM(p.amount_cop) FROM credit_payments p WHERE p.order_id=o.id),0)),0) balance
 FROM credit_sales cs JOIN orders o ON o.id=cs.order_id WHERE o.status='delivered' AND NOT o.sale_removed
 ), payments AS (
 SELECT COALESCE(SUM(p.amount_cop),0) total FROM credit_payments p JOIN orders o ON o.id=p.order_id,bounds b WHERE NOT o.sale_removed AND o.status='delivered' AND p.created_at>=b.start_at AND p.created_at<b.end_at AND p.created_at<>o.created_at
 ) SELECT jsonb_build_object(
 'from',$1::text,'to',$2::text,'timezone','America/Bogota',
 'salesCop',COALESCE((SELECT SUM(total_cop) FROM sales),0),'saleCount',(SELECT COUNT(*) FROM sales),
 'cashCop',COALESCE((SELECT SUM(cash) FROM daily),0),'creditCop',COALESCE((SELECT SUM(credit) FROM daily),0),
 'paymentsCop',(SELECT total FROM payments),'balanceCop',(SELECT balance FROM debt),
 'daily',(SELECT COALESCE(jsonb_agg(jsonb_build_object('day',d.day,'totalCop',COALESCE(s.total,0),'cashCop',COALESCE(s.cash,0),'creditCop',COALESCE(s.credit,0)) ORDER BY d.day),'[]'::jsonb) FROM (SELECT generate_series($1::date,$2::date,'1 day')::date day) d LEFT JOIN daily s USING(day)),
 'topProducts',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',name,'totalCop',total) ORDER BY total DESC),'[]'::jsonb) FROM tops),
 'inventory',jsonb_build_object('available',(SELECT COUNT(*) FROM products WHERE stock-reserved>minimum),'low',(SELECT COUNT(*) FROM products WHERE stock-reserved>0 AND stock-reserved<=minimum),'out',(SELECT COUNT(*) FROM products WHERE stock-reserved=0))
 ) report`,
    [from, to],
  );
  return rows[0].report;
}
