-- Fila de trabalhos longos pedidos pelo Telegram (montar carrossel, buscar recrutadores...).
-- O webhook só tem ~30 s; o cron de cada minuto roda o trabalho com até 15 min.
CREATE TABLE IF NOT EXISTS jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL,   -- pending | running | done | failed
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status, id);
