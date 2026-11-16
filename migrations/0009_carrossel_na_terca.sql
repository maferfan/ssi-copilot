-- O carrossel passou de sexta 18h para terça 8h30: os já agendados vão para a terça seguinte à sexta deles.
UPDATE carousels SET scheduled_for = date(scheduled_for, 'weekday 2')
WHERE status = 'approved' AND scheduled_for IS NOT NULL;
