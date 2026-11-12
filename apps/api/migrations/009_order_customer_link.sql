ALTER TABLE orders ADD COLUMN customer_id uuid REFERENCES app_users(id);
UPDATE orders o SET customer_id=s.client_id FROM credit_sales s WHERE s.order_id=o.id;
CREATE INDEX orders_customer ON orders(customer_id,created_at);
