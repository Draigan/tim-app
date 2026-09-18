-- Team chat is gone from the app. The page, its route and the push broadcast
-- that fanned every message out to all subscribed devices are all removed, so
-- nothing reads or writes this table any more.
--
-- Dropping it discards the message history permanently.

drop table if exists public.messages;
