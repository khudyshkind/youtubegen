-- legal_acceptances: records user consent to legal documents at registration
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document    text        NOT NULL,  -- 'offer' | 'terms' | 'privacy'
  version     text        NOT NULL,  -- e.g. '1.0'
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legal_acceptances_user_id_idx ON legal_acceptances(user_id);

ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own acceptances"
  ON legal_acceptances FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own acceptances"
  ON legal_acceptances FOR INSERT
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON legal_acceptances TO authenticated;
