-- Login moves from SMS to email: the one-time code goes to the person's email address.
-- otp_codes.phone now holds whatever the code was sent to (an email, lower-case).
ALTER TABLE otp_codes RENAME COLUMN phone TO contact;
ALTER INDEX otp_codes_phone_created RENAME TO otp_codes_contact_created;

-- Adults need a way to log in: an email (new) or a mobile (accounts made before this change).
ALTER TABLE users DROP CONSTRAINT users_mobile_required;
ALTER TABLE users ADD CONSTRAINT users_contact_required CHECK (role = 'minor' OR mobile IS NOT NULL OR email IS NOT NULL);

-- A school's login is its contact's email. The mobile stays as an optional phone number for staff to call.
ALTER TABLE schools ADD COLUMN contact_email text;
ALTER TABLE schools ALTER COLUMN contact_mobile DROP NOT NULL;
DROP INDEX schools_one_live_per_mobile;
CREATE UNIQUE INDEX schools_one_live_per_email ON schools (contact_email) WHERE status IN ('pending','approved') AND contact_email IS NOT NULL;
