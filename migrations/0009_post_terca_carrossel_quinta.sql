-- Publicação deixou de ser na sexta às 18h: post de imagem na terça e carrossel na quinta, às 8h30.
-- Os carrosséis já agendados para uma sexta vão para a quinta seguinte.
UPDATE carousels SET scheduled_for = date(scheduled_for, 'weekday 4')
WHERE status = 'approved' AND scheduled_for IS NOT NULL;
