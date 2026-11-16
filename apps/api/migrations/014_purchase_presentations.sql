ALTER TABLE products ADD COLUMN purchase_presentations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(purchase_presentations)='array');
UPDATE products SET purchase_presentations=jsonb_build_array(purchase_presentation) WHERE purchase_presentation<>'';
