-- Let authenticated app clients provide a pre-generated customer id.
--
-- Customer creation now retries transient network failures with the same id.
-- If the first insert reaches Postgres but the phone loses the response, the
-- retry can detect the duplicate id and load that same customer instead of
-- creating a second record.
grant insert (id) on table public.customers to authenticated;
