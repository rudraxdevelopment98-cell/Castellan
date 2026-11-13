-- Accounts created before email verification existed (AUDIT H5) had no way to
-- verify, and verification is now required to sign in. Grandfather them as
-- verified so they are not locked out. New accounts verify by email.
UPDATE "users" SET "email_verified_at" = "created_at"
WHERE "email_verified_at" IS NULL AND "password_hash" IS NOT NULL;
