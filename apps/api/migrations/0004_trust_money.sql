-- Phase 2c: reports, strikes, disputes, refunds, payout runs.

-- Strikes and suspensions
ALTER TABLE users ADD COLUMN suspended_until timestamptz;
ALTER TABLE teacher_profiles ADD COLUMN payouts_frozen boolean NOT NULL DEFAULT false;
ALTER TABLE strikes ADD COLUMN action text NOT NULL DEFAULT 'warn' CHECK (action IN ('warn','suspend_14d','ban'));
ALTER TABLE strikes ADD COLUMN report_id uuid REFERENCES reports(id);
CREATE INDEX strikes_user_created ON strikes (user_id, created_at);

-- Reports (user-filed) and flags (rule-filed) share one review queue
ALTER TABLE reports ADD COLUMN category text NOT NULL DEFAULT 'other' CHECK (category IN ('conduct','safety','no_show','payment','other'));
ALTER TABLE reports ADD COLUMN resolution_note text;
ALTER TABLE reports ADD COLUMN resolved_at timestamptz;
CREATE INDEX reports_status_created ON reports (status, created_at);

ALTER TABLE flags ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','dismissed'));
ALTER TABLE flags ADD COLUMN reviewed_by uuid REFERENCES users(id);
ALTER TABLE flags ADD COLUMN reviewed_at timestamptz;
ALTER TABLE flags ADD COLUMN note text;
CREATE INDEX flags_status_severity ON flags (status, severity DESC, created_at);

-- Disputes: open until a finance officer decides
ALTER TABLE disputes ADD COLUMN refund_halalas int NOT NULL DEFAULT 0 CHECK (refund_halalas >= 0);
ALTER TABLE disputes ADD COLUMN note text;
CREATE INDEX disputes_open ON disputes (created_at) WHERE outcome IS NULL;

-- Payout runs
ALTER TABLE payouts ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE payouts ADD COLUMN needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE payouts ADD COLUMN bank_reference text;
ALTER TABLE payouts ADD COLUMN note text;
CREATE INDEX payouts_status ON payouts (status, created_at);
CREATE INDEX payments_unpaid ON payments (payout_eligible_at) WHERE payout_id IS NULL AND status IN ('captured','partially_refunded');
