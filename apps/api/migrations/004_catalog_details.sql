ALTER TABLE products ADD COLUMN category text NOT NULL DEFAULT 'Despensa', ADD COLUMN code text NOT NULL DEFAULT '', ADD COLUMN supplier text NOT NULL DEFAULT '', ADD COLUMN description text NOT NULL DEFAULT '', ADD COLUMN photo text NOT NULL DEFAULT '';
CREATE TABLE clients(id uuid PRIMARY KEY,name text NOT NULL,contact text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE orders ADD COLUMN cash_received integer, ADD COLUMN cash_change integer;
CREATE TABLE inventory_notice_reads(user_id text NOT NULL,product_id uuid NOT NULL REFERENCES products(id),version integer NOT NULL,read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,product_id,version));
