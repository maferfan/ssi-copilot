-- Configurações simples (dono do bot, estado da conversa)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Posts que o usuário salvou para comentar
CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  url            TEXT NOT NULL,
  author         TEXT,
  text           TEXT,
  -- needs_text | pending | drafted | approved | commented | skipped
  status         TEXT NOT NULL,
  draft          TEXT,
  final_comment  TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status, created_at);

-- Tudo que o usuário fez de verdade: alimenta o resumo e o dashboard
CREATE TABLE IF NOT EXISTS actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,   -- comment | post | invite | ssi
  ref_id      INTEGER,
  value       REAL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions (created_at);
