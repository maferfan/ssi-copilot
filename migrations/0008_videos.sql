-- Roteiros de vídeo (Reels/TikTok): o bot escreve, o usuário grava a voz e, depois, o bot edita
CREATE TABLE IF NOT EXISTS videos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  topic       TEXT NOT NULL,
  script      TEXT NOT NULL,   -- JSON: título, trechos com fala e imagem, fontes, legenda
  status      TEXT NOT NULL,   -- draft | discarded | recorded | rendered | posted
  created_at  TEXT NOT NULL
);
