-- Strict arrival order for messages: created_at comes from the app clock (ms resolution),
-- so two messages sent in the same millisecond tied and fell back to random uuid order.
ALTER TABLE messages ADD COLUMN seq bigserial;
CREATE INDEX messages_inquiry_seq_idx ON messages (inquiry_id, seq);
