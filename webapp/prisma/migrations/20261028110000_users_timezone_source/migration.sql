-- Phase 9 S-03 / SQL S-3 (D3, D39; users table, not financial; the owner allowed the
-- agent to apply migrations): where the stored zone came from. The device zone may
-- update it silently only while it is DEFAULT or DEVICE; a USER or ADMIN choice is
-- never overwritten.
ALTER TABLE "users" ADD COLUMN "timezone_source" VARCHAR(8) NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE "users" ADD CONSTRAINT "users_timezone_source_check" CHECK ("timezone_source" IN ('DEFAULT', 'DEVICE', 'USER', 'ADMIN'));
