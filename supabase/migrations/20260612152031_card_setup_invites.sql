create table public.card_setup_invites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  token_hash text not null unique,
  return_origin text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  last_opened_at timestamptz,
  revoked_at timestamptz
);

alter table public.card_setup_invites enable row level security;

revoke all on table public.card_setup_invites from anon;
revoke all on table public.card_setup_invites from authenticated;

create index card_setup_invites_customer_id_idx on public.card_setup_invites(customer_id);
create index card_setup_invites_expires_at_idx on public.card_setup_invites(expires_at);
