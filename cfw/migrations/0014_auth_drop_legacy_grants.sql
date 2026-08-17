-- Adopting `@open-athena/auth` (specs/auth-adoption.md): its `grants` schema is
-- backwards-incompatible with 0007's (random TEXT ids, epoch-second timestamps,
-- `label`→`name`, `use_count`→`redeems`). Verified before dropping: 2 rows on
-- the OA instance (both revoked), 0 on the base instance — nothing live to
-- preserve, and any link still in circulation was already dead.
DROP TABLE IF EXISTS grants;
