alter table customers
  add column stripe_customer_id      text,
  add column stripe_payment_method_id text;
