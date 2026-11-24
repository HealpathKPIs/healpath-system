-- Phase 2.1 rollback for import governance only.
-- Review and approval are required before execution. This script never
-- references or modifies Acute fact tables or existing importer objects.

begin;

do $$
begin
  if to_regclass('healpath.import_batches') is not null then execute 'revoke all on table healpath.import_batches from public, anon, authenticated, service_role'; end if;
  if to_regclass('healpath.import_reconciliation') is not null then execute 'revoke all on table healpath.import_reconciliation from public, anon, authenticated, service_role'; end if;
  if to_regclass('healpath.import_events') is not null then execute 'revoke all on table healpath.import_events from public, anon, authenticated, service_role'; end if;
  if to_regclass('healpath.data_versions') is not null then execute 'revoke all on table healpath.data_versions from public, anon, authenticated, service_role'; end if;
  if to_regclass('healpath.import_reconciliation_id_seq') is not null then execute 'revoke all on sequence healpath.import_reconciliation_id_seq from public, anon, authenticated, service_role'; end if;
  if to_regclass('healpath.import_events_id_seq') is not null then execute 'revoke all on sequence healpath.import_events_id_seq from public, anon, authenticated, service_role'; end if;
end $$;

drop table if exists healpath.data_versions;
drop table if exists healpath.import_events;
drop table if exists healpath.import_reconciliation;
drop table if exists healpath.import_batches;

commit;
