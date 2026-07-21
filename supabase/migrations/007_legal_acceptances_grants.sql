-- service_role bypasses RLS but still requires table-level privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON legal_acceptances TO service_role;
