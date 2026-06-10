alter table portable_storage_rentals
  add column if not exists paid_through_date date;

with paid_periods as (
  select
    psr.asset_id,
    max(
      (
        make_date(
          extract(year from (to_date(psp.period_label || '-01', 'YYYY-MM-DD') + interval '1 month'))::int,
          extract(month from (to_date(psp.period_label || '-01', 'YYYY-MM-DD') + interval '1 month'))::int,
          least(
            psr.billing_day,
            extract(day from (
              date_trunc('month', to_date(psp.period_label || '-01', 'YYYY-MM-DD') + interval '2 months')
              - interval '1 day'
            ))::int
          )
        ) - interval '1 day'
      )::date
    ) as paid_through_date
  from portable_storage_rentals psr
  join portable_storage_payments psp on psp.asset_id = psr.asset_id
  where psr.billing_day is not null
    and psp.period_label ~ '^\d{4}-\d{2}$'
  group by psr.asset_id
)
update portable_storage_rentals psr
set paid_through_date = paid_periods.paid_through_date
from paid_periods
where psr.asset_id = paid_periods.asset_id;

create index if not exists portable_storage_rentals_paid_through_date_idx
  on portable_storage_rentals(paid_through_date);
