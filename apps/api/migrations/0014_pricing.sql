-- Configurable commission (founding teachers vs everyone else) and discount codes.

CREATE TABLE platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Defaults: founding teachers (first 100 approved) 5% for the first 10 lessons with a learner, then 3%; everyone else 15% then 10%.
INSERT INTO platform_settings (key, value) VALUES ('commission',
  '{"founderLimit":100,"founder":{"initialBps":500,"afterBps":300,"threshold":10},"standard":{"initialBps":1500,"afterBps":1000,"threshold":10}}');

ALTER TABLE teacher_profiles ADD COLUMN founding boolean NOT NULL DEFAULT false;
UPDATE teacher_profiles SET founding = true
 WHERE user_id IN (SELECT user_id FROM teacher_profiles WHERE approved_at IS NOT NULL ORDER BY approved_at, user_id LIMIT 100);

-- The rate actually applied is kept on the payment, so a later settings change never rewrites history.
ALTER TABLE payments ADD COLUMN commission_bps int;

CREATE TABLE discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code = upper(code) AND code ~ '^[A-Z0-9_-]{3,24}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
  kind text NOT NULL CHECK (kind IN ('percent','fixed')),
  value int NOT NULL CHECK (value > 0),
  max_uses int CHECK (max_uses IS NULL OR max_uses > 0),
  per_user_limit int NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'percent' OR value <= 90),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX discount_codes_code ON discount_codes (code);

-- price_halalas stays what the learner pays (and what the card hold is for); list_price_halalas is the teacher's price.
-- The platform funds the difference: it is paid to the teacher as platform credit, so the teacher's net never drops.
ALTER TABLE bookings ADD COLUMN list_price_halalas int CHECK (list_price_halalas IS NULL OR list_price_halalas >= price_halalas);
ALTER TABLE bookings ADD COLUMN discount_code_id uuid REFERENCES discount_codes(id);
CREATE INDEX bookings_discount_code ON bookings (discount_code_id) WHERE discount_code_id IS NOT NULL;
