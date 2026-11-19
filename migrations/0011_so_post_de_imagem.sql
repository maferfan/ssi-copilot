-- O bot deixou de fazer carrosséis (o post de imagem rendeu mais).
-- Carrosséis ainda na fila ou em rascunho são descartados; os publicados ficam no histórico.
UPDATE carousels SET status = 'discarded'
WHERE status IN ('draft', 'approved') AND json_extract(content, '$.imagem') IS NULL;
