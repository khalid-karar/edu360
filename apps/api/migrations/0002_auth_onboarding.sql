-- Phase 2: login, sessions, staff MFA, identity requests, teacher onboarding.

-- One-time codes. Only an HMAC of the code is stored, never the code.
CREATE TABLE otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX otp_codes_phone_created ON otp_codes (phone, created_at DESC);

-- Opaque bearer login sessions (the lesson room table from 0001 is `sessions`). Only the SHA-256 of the token is stored.
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text UNIQUE NOT NULL,
  mfa_verified boolean NOT NULL DEFAULT false,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX auth_sessions_user ON auth_sessions (user_id);

-- Staff second factor (TOTP). The secret is encrypted with MFA_ENC_KEY.
-- last_step blocks replay of a code that was already accepted.
CREATE TABLE staff_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  secret_enc text NOT NULL,
  last_step bigint NOT NULL DEFAULT 0,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);

-- Links a Nafath request to the user who started it, so nobody can poll or claim another user's request.
CREATE TABLE nafath_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider_request_id text NOT NULL,
  national_id_hash text NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','approved','rejected','expired','failed')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX nafath_user_created ON nafath_requests (user_id, created_at DESC);

ALTER TABLE identity_verifications ADD CONSTRAINT identity_one_per_user UNIQUE (user_id);

ALTER TABLE teacher_profiles ADD COLUMN submitted_at timestamptz;
-- A category is only searchable and bookable once a vetting officer has accepted proof for it.
ALTER TABLE teacher_categories ADD COLUMN approved boolean NOT NULL DEFAULT false;
