CREATE TABLE IF NOT EXISTS workspace_settings (
  account_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL
);
