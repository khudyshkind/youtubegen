-- Apply missing grants on legal_acceptances.
-- Migration 006 created the table but grants were not applied to the database.
GRANT SELECT, INSERT ON legal_acceptances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON legal_acceptances TO service_role;
