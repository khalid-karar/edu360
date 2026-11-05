-- Edu360 core schema (draft v0). PostgreSQL 15+.
-- Money is stored in halalas (integer) to avoid float errors. All timestamps are UTC.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('learner','guardian','minor','teacher',
  'vetting_officer','safety_officer','finance_officer','super_admin');
CREATE TYPE user_status AS ENUM ('pending','active','suspended','banned');
CREATE TYPE teacher_status AS ENUM ('draft','submitted','interview','approved','conditional','rejected','suspended');
CREATE TYPE booking_status AS ENUM ('requested','confirmed','declined','cancelled','completed','no_show_teacher','no_show_learner');
-- Authorize at booking, capture after the lesson, void on decline/no-show/early cancel (Moyasar).
CREATE TYPE payment_status AS ENUM ('authorized','captured','voided','refunded','partially_refunded','failed');
CREATE TYPE payout_status AS ENUM ('pending','approved','paid','failed','on_hold');
CREATE TYPE report_status AS ENUM ('open','reviewing','resolved','dismissed');
CREATE TYPE dispute_outcome AS ENUM ('full_refund','partial_refund','release_to_teacher');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL,
  status user_status NOT NULL DEFAULT 'pending',
  mobile text UNIQUE NOT NULL,
  email text UNIQUE,
  display_name text NOT NULL,
  locale text NOT NULL DEFAULT 'ar',
  guardian_id uuid REFERENCES users(id),          -- set for role = 'minor'
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'minor') = (guardian_id IS NOT NULL))
);

CREATE TABLE identity_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  provider text NOT NULL DEFAULT 'nafath',
  national_id_hash text NOT NULL UNIQUE,          -- hashed; one account per national ID
  full_name text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('female','male')),
  date_of_birth date NOT NULL,
  face_match_score numeric(4,3),
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id serial PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  name_ar text NOT NULL,
  name_en text NOT NULL,
  min_price_halalas int NOT NULL,
  max_price_halalas int NOT NULL,
  allows_minors boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  CHECK (min_price_halalas <= max_price_halalas)
);

CREATE TABLE teacher_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  status teacher_status NOT NULL DEFAULT 'draft',
  freelance_document_no text,
  employer_noc_url text,
  bio text,
  intro_video_url text,
  languages text[] NOT NULL DEFAULT '{}',
  adults_only boolean NOT NULL DEFAULT false,
  iban text,
  iban_holder_name text,
  reliability_score numeric(4,3) NOT NULL DEFAULT 1.000,
  completed_sessions int NOT NULL DEFAULT 0,
  approved_at timestamptz,
  code_of_conduct_version text,
  code_of_conduct_signed_at timestamptz
);

CREATE TABLE teacher_categories (
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id),
  category_id int NOT NULL REFERENCES categories(id),
  price_halalas int NOT NULL,
  PRIMARY KEY (teacher_id, category_id)
);

CREATE TABLE credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id),
  category_id int NOT NULL REFERENCES categories(id),
  kind text NOT NULL,                              -- degree | ijazah | certificate | portfolio | sample_video
  file_url text NOT NULL,
  reviewed_by uuid REFERENCES users(id),
  verdict text CHECK (verdict IN ('accepted','rejected')),
  reviewed_at timestamptz
);

CREATE TABLE vetting_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id),
  officer_id uuid NOT NULL REFERENCES users(id),
  rubric jsonb NOT NULL,                           -- knowledge, communication, conduct, tech setup
  decision teacher_status NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (starts_at < ends_at)
);

CREATE TABLE guardian_teacher_approvals (
  guardian_id uuid NOT NULL REFERENCES users(id),
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardian_id, teacher_id)
);

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES users(id),   -- minor or adult learner
  payer_id uuid NOT NULL REFERENCES users(id),     -- learner or guardian
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id),
  category_id int NOT NULL REFERENCES categories(id),
  status booking_status NOT NULL DEFAULT 'requested',
  starts_at timestamptz NOT NULL,
  duration_min int NOT NULL DEFAULT 60,
  price_halalas int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON bookings (teacher_id, starts_at);
CREATE INDEX ON bookings (learner_id, starts_at);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE NOT NULL REFERENCES bookings(id),
  room_name text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  teacher_joined_at timestamptz,
  learner_joined_at timestamptz,
  recording_url text,
  recording_expires_at timestamptz,                -- retention policy, e.g. 90 days
  lesson_note text
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  body text NOT NULL,
  blocked boolean NOT NULL DEFAULT false,          -- true if filtered, not delivered
  block_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES teacher_profiles(user_id),
  amount_halalas int NOT NULL,
  status payout_status NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES users(id),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE NOT NULL REFERENCES bookings(id),
  provider text NOT NULL DEFAULT 'moyasar',
  psp_reference text UNIQUE NOT NULL,              -- one provider payment can back only one booking
  currency text NOT NULL DEFAULT 'SAR' CHECK (currency = 'SAR'),
  amount_halalas int NOT NULL CHECK (amount_halalas > 0),      -- authorized amount
  captured_halalas int NOT NULL DEFAULT 0,
  refunded_halalas int NOT NULL DEFAULT 0,
  commission_halalas int NOT NULL DEFAULT 0,
  vat_halalas int NOT NULL DEFAULT 0,
  status payment_status NOT NULL DEFAULT 'authorized',
  authorized_at timestamptz,
  captured_at timestamptz,
  voided_at timestamptz,
  payout_eligible_at timestamptz,                  -- captured_at + 48 h dispute window
  payout_id uuid REFERENCES payouts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (captured_halalas <= amount_halalas),
  CHECK (refunded_halalas <= captured_halalas)
);

CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE NOT NULL REFERENCES bookings(id),  -- only completed, paid bookings
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,                            -- rule | classifier | user
  target_type text NOT NULL,                       -- message | session | profile
  target_id uuid NOT NULL,
  category text NOT NULL,                          -- leakage | grooming | cheating | abuse | prohibited
  severity int NOT NULL CHECK (severity BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES users(id),
  booking_id uuid REFERENCES bookings(id),
  reported_user_id uuid REFERENCES users(id),
  reason text NOT NULL,
  status report_status NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid UNIQUE NOT NULL REFERENCES bookings(id),
  opened_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  outcome dispute_outcome,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  level int NOT NULL CHECK (level BETWEEN 1 AND 3),
  zero_tolerance boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  issued_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only: nobody gets UPDATE or DELETE on this table.
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
