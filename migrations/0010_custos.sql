-- Custo de cada chamada ao Claude (US$, pelo uso de tokens e buscas), para o /custos e o teto mensal
CREATE TABLE IF NOT EXISTS costs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,   -- comentario | cena | carrossel | post | temas | vagas
  usd         REAL NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_costs_created ON costs (created_at);
