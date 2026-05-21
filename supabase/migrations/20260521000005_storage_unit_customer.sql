alter table storage_units add column customer_id uuid references customers(id) on delete set null;
