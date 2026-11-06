-- Cada carrossel aprovado ocupa uma sexta (AAAA-MM-DD, horário de Brasília).
-- Aprovar outro com a próxima sexta ocupada o coloca na sexta seguinte, e assim por diante.
ALTER TABLE carousels ADD COLUMN scheduled_for TEXT;
