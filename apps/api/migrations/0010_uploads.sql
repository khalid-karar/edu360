-- Files people upload (teacher credential scans). The bytes live in object storage; this table is the record of who owns what.
CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id),
  key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  created_at timestamptz NOT NULL
);
CREATE INDEX uploads_owner ON uploads (owner_id, created_at DESC);
