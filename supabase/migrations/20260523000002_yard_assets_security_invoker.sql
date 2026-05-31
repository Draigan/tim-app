drop view if exists yard_assets;
create view yard_assets
  with (security_invoker = true)
  as
  SELECT a.id, a.asset_type_id, a.size, a.label, a.notes, a.created_at, t.name AS type_name
  FROM assets a
  JOIN asset_types t ON t.id = a.asset_type_id
  WHERE NOT EXISTS (
    SELECT 1 FROM deployments d
    WHERE d.asset_id = a.id AND d.picked_up_at IS NULL
  )
  AND a.archived = false;
