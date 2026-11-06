-- Recrutadores sugeridos aos domingos (o convite é feito à mão: o LinkedIn não tem API para isso)
CREATE TABLE IF NOT EXISTS recruiters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  url         TEXT NOT NULL UNIQUE,   -- linkedin.com/in/<perfil>, normalizado
  name        TEXT NOT NULL,
  headline    TEXT,
  language    TEXT NOT NULL,          -- pt | en
  note        TEXT,                   -- nota de conexão (só os primeiros da semana)
  week        TEXT NOT NULL,          -- semana em que foi sugerido
  batch       INTEGER NOT NULL,       -- bloco de 10 na mensagem do Telegram
  status      TEXT NOT NULL,          -- suggested | invited
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recruiters_batch ON recruiters (week, batch);
