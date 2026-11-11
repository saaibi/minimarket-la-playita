CREATE TABLE google_identities (
  subject text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE google_challenges (
  id uuid PRIMARY KEY,
  client_type text NOT NULL CHECK (client_type IN ('web','native')),
  proof_hash text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz
);
CREATE INDEX google_challenges_expiry ON google_challenges(expires_at);
