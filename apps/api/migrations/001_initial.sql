CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE products(id uuid PRIMARY KEY,name text NOT NULL,kind text NOT NULL CHECK(kind IN ('unit','weight')),price_cop integer NOT NULL CHECK(price_cop>=0),cost_cop integer NOT NULL CHECK(cost_cop>=0),stock integer NOT NULL CHECK(stock>=0),reserved integer NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=stock),minimum integer NOT NULL CHECK(minimum>=0),visible boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1);
CREATE TABLE presentations(id uuid PRIMARY KEY,product_id uuid NOT NULL REFERENCES products(id),name text NOT NULL,factor integer NOT NULL CHECK(factor>0),price_cop integer NOT NULL CHECK(price_cop>=0),is_base boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX one_base_presentation ON presentations(product_id) WHERE is_base;
CREATE TABLE orders(id uuid PRIMARY KEY,owner_id text NOT NULL,status text NOT NULL CHECK(status IN ('confirmed','accepted','ready','delivered','cancelled')),payment_method text NOT NULL CHECK(payment_method IN ('cash','nequi')),payment_status text NOT NULL CHECK(payment_status IN ('pending','not_integrated','paid')),client_name text NOT NULL DEFAULT 'Cliente general',client_reference text NOT NULL DEFAULT '',total_cop integer NOT NULL CHECK(total_cop>=0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE order_lines(id bigserial PRIMARY KEY,order_id uuid NOT NULL REFERENCES orders(id),product_id uuid NOT NULL REFERENCES products(id),product_name text NOT NULL,kind text NOT NULL,presentation_id uuid,presentation_name text,units_per_package integer,quantity integer NOT NULL CHECK(quantity>0),base_quantity integer NOT NULL CHECK(base_quantity>0),price_cop integer NOT NULL CHECK(price_cop>=0),total_cop integer NOT NULL CHECK(total_cop>=0));
CREATE INDEX orders_owner ON orders(owner_id,created_at DESC);
CREATE TABLE idempotency(actor_id text NOT NULL,key text NOT NULL,request_hash text NOT NULL,status_code integer NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,key));
CREATE TABLE events(id bigserial PRIMARY KEY,kind text NOT NULL,owner_id text,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX events_owner ON events(owner_id,id);
INSERT INTO products(id,name,kind,price_cop,cost_cop,stock,minimum) VALUES
('11111111-1111-4111-8111-111111111111','Huevos campesinos (ejemplo)','unit',650,460,90,12),
('22222222-2222-4222-8222-222222222222','Papa criolla (ejemplo)','weight',4000,2400,18500,5000);
INSERT INTO presentations(id,product_id,name,factor,price_cop,is_base) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','11111111-1111-4111-8111-111111111111','1 huevo',1,650,true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','11111111-1111-4111-8111-111111111111','Medio cartón',15,9000,false),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','11111111-1111-4111-8111-111111111111','Cartón completo',30,17000,false);
