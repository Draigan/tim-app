alter table storage_tenancies
  add column paid_through_date date;

with paid_periods as (
  select
    st.id as tenancy_id,
    max(
      (
        make_date(
          extract(year from (to_date(sp.period_label || '-01', 'YYYY-MM-DD') + interval '1 month'))::int,
          extract(month from (to_date(sp.period_label || '-01', 'YYYY-MM-DD') + interval '1 month'))::int,
          least(
            st.billing_day,
            extract(day from (
              date_trunc('month', to_date(sp.period_label || '-01', 'YYYY-MM-DD') + interval '2 months')
              - interval '1 day'
            ))::int
          )
        ) - interval '1 day'
      )::date
    ) as paid_through_date
  from storage_tenancies st
  join storage_payments sp on sp.tenancy_id = st.id
  where st.billing_day is not null
    and sp.period_label ~ '^\d{4}-\d{2}$'
  group by st.id
)
update storage_tenancies st
set paid_through_date = paid_periods.paid_through_date
from paid_periods
where st.id = paid_periods.tenancy_id;

create index storage_tenancies_paid_through_date_idx
  on storage_tenancies(paid_through_date);
