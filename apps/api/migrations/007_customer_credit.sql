CREATE TABLE credit_sales(order_id uuid PRIMARY KEY REFERENCES orders(id),client_id uuid NOT NULL REFERENCES app_users(id));
CREATE INDEX credit_sales_client ON credit_sales(client_id);
CREATE TABLE credit_payments(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES credit_sales(order_id),amount_cop integer NOT NULL CHECK(amount_cop>0),actor_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
