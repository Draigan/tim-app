-- Allow multiple partial receipts per payment
ALTER TABLE admin_payment_received
  DROP CONSTRAINT admin_payment_received_payment_type_payment_id_key;

ALTER TABLE admin_payment_received
  ADD COLUMN amount_received DECIMAL(10, 2) NOT NULL DEFAULT 0;
