update asset_types
set is_storage = true
where lower(name) in ('portable storage', 'portable storage unit', 'portable storage units');
