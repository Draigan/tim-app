alter table customers add column pin char(4);

update customers
set pin = lpad((floor(random() * 9000) + 1000)::int::text, 4, '0')
where pin is null;
