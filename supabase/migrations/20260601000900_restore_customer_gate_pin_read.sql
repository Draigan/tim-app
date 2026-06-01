-- Customer PINs are operational gate/access codes, not Stripe secrets.
-- Keep writes server/default-controlled, but allow authenticated staff to read
-- them through the existing customer RLS policy.

grant select (pin) on table public.customers to authenticated;
