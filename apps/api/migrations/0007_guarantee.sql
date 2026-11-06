-- Phase 4c: first-lesson guarantee. A claim is recorded as a dispute of kind 'guarantee' decided by the system,
-- and the platform tops the teacher up (platform_credit_halalas), which the payout run adds to the teacher's net.
ALTER TABLE disputes ADD COLUMN kind text NOT NULL DEFAULT 'dispute' CHECK (kind IN ('dispute','guarantee'));
ALTER TABLE payments ADD COLUMN platform_credit_halalas int NOT NULL DEFAULT 0 CHECK (platform_credit_halalas >= 0);
CREATE INDEX disputes_guarantee_by_user ON disputes (opened_by) WHERE kind = 'guarantee';
