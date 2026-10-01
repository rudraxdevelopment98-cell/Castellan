-- Castellan v2.0 — Row-Level Security for tenant tables.
--
-- Isolation model (spec tenancy_model.isolation_must): the query layer sets the
-- GUC `app.workspace_id` per transaction; every tenant table's policy filters on
-- it. `app.bypass = 'on'` is the service path used only for auth, workspace
-- bootstrap and background jobs (which then set app.workspace_id per job). On
-- Supabase the service role additionally has BYPASSRLS.
--
-- Custom `app.*` GUCs read back as '' (empty string), not NULL, once they have
-- been set in a session, so we wrap with NULLIF(...,'')::uuid — an unset/empty
-- scope becomes NULL and matches no rows (fail closed) instead of erroring on
-- an empty-string uuid cast.
--
-- FORCE ROW LEVEL SECURITY makes even the table owner subject to the policies,
-- so isolation holds in tests (PGlite drops to a NOSUPERUSER role) exactly as on
-- Supabase, where the app connects as a non-superuser.

-- workspaces: a tenant only sees its own workspace row; inserts go via bypass.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_select ON workspaces FOR SELECT USING (
  id = nullif(current_setting('app.workspace_id', true), '')::uuid
  OR current_setting('app.bypass', true) = 'on'
);
CREATE POLICY ws_insert ON workspaces FOR INSERT WITH CHECK (
  current_setting('app.bypass', true) = 'on'
);
CREATE POLICY ws_update ON workspaces FOR UPDATE USING (
  id = nullif(current_setting('app.workspace_id', true), '')::uuid
  OR current_setting('app.bypass', true) = 'on'
) WITH CHECK (
  id = nullif(current_setting('app.workspace_id', true), '')::uuid
  OR current_setting('app.bypass', true) = 'on'
);
CREATE POLICY ws_delete ON workspaces FOR DELETE USING (
  current_setting('app.bypass', true) = 'on'
);

-- Generic per-tenant tables keyed by workspace_id.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['teams','memberships','team_members','invitations','audit_log','object_defs','field_defs','records','record_links','record_history','outbox','rules','obligations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format($f$
      CREATE POLICY %1$s_tenant ON %1$I
      USING (
        workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
        OR current_setting('app.bypass', true) = 'on'
      )
      WITH CHECK (
        workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
        OR current_setting('app.bypass', true) = 'on'
      );
    $f$, tbl);
  END LOOP;
END $$;
