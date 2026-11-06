-- Números da semana copiados das Análises do LinkedIn (o SSI saiu do plano gratuito)
CREATE TABLE IF NOT EXISTS metrics (
  week           TEXT PRIMARY KEY,   -- segunda-feira da semana (AAAA-MM-DD, horário de Brasília)
  profile_views  INTEGER NOT NULL,
  impressions    INTEGER NOT NULL,
  followers      INTEGER NOT NULL,
  updated_at     TEXT NOT NULL
);

-- Link do carrossel publicado, para o dashboard
ALTER TABLE carousels ADD COLUMN post_url TEXT;
