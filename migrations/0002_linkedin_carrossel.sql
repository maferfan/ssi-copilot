-- Identificador do post no LinkedIn, para comentar pela API
ALTER TABLE posts ADD COLUMN urn TEXT;

-- Carrosséis de sexta
CREATE TABLE IF NOT EXISTS carousels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic         TEXT NOT NULL,
  content       TEXT NOT NULL,   -- JSON com capa, slides, fechamento e legenda
  -- draft | approved | published | failed | discarded
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  published_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_carousels_status ON carousels (status, created_at);
