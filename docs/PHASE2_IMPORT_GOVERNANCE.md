# Phase 2 — Import governance and reconciliation

This phase adds an additive, admin-only governance ledger around the trusted Acute importer. The importer, its routes/pages, parsing, normalization, conflict targets, transaction order, and database writes are not modified.

## Safety boundary

`/api/admin/import-governance/prepare` fingerprints a supplied file and captures aggregate BEFORE evidence. It does not parse the workbook and does not invoke the importer. `/api/admin/import-governance/[id]/reconcile` captures aggregate AFTER evidence only. Because the existing importer is deliberately unintegrated, inserted/updated/unchanged/rejected counts and importer success attribution remain `UNKNOWN`; a lost response remains `UNKNOWN`.

The migration is additive and must be reviewed before execution. It has not been executed against production by this implementation. The new tables contain no patient-level rows or identifiers.

Phase 2.1 enables RLS on every governance table, revokes direct access from `public`, `anon`, and `authenticated`, and grants authenticated `SELECT` only. The RLS policies require an active administrator profile; server-side governance writes use the explicit `service_role` grant. JSONB checks reject sensitive field names and non-object values, while application validation remains mandatory because arbitrary JSON values cannot be proven aggregate-only by SQL alone. `initiated_by_user_id` is the authoritative nullable foreign key to `public.profiles`; the older text value is retained only as a legacy display field.

If an existing governance table is missing required columns, the migration raises an exception instead of silently accepting an incompatible definition. The companion rollback migration drops only the four governance tables in dependency order.

## Verification rules

- A repeated SHA-256 is reported as an exact file already seen; it is never blocked.
- Table-count decreases and post-observation fact orphans are failures.
- A no-change observation is a warning, but importer outcome remains unknown.
- A data version can be created only from a result explicitly marked `PASS` with no unknowns or failures. The current observation path cannot manufacture that state.
- Legacy fact rows remain legacy and are never attributed to a governance batch.

## Admin views

`/admin/import-history` lists durable batches, file fingerprints, user attribution when supplied by the authenticated profile, status, and reconciliation state. `/admin/import-history/[id]` shows aggregate before/after metrics and append-only events. No patient-level data is rendered.
