-- Physically confirming which assets actually exist. More were entered than are
-- really in the yard, so each one gets checked off when someone lays eyes on it.
alter table assets add column if not exists verified_at timestamptz;
alter table assets add column if not exists verified_by text;
