CREATE TABLE credit_openings (
 id uuid PRIMARY KEY,
 client_id uuid NOT NULL UNIQUE REFERENCES app_users(id),
 amount_cop integer NOT NULL CHECK(amount_cop>0),
 reason text NOT NULL,
 actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_opening_payments (
 id uuid PRIMARY KEY,
 opening_id uuid NOT NULL REFERENCES credit_openings(id),
 amount_cop integer NOT NULL CHECK(amount_cop>0),
 actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_opening_payments_opening ON credit_opening_payments(opening_id);
