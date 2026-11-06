/**
 * Horários do cron (UTC). Precisam ser iguais aos de wrangler.toml; um teste confere.
 * A Cloudflare não aceita 0 para domingo no dia da semana: use SUN.
 */
export const CRONS = {
  /** 18h em Brasília: comentários todo dia, lembrete na quinta, carrossel na sexta, resumo no domingo */
  daily: "0 21 * * *",
  /** A cada minuto: fila de trabalhos longos pedidos pelo Telegram */
  queue: "* * * * *",
} as const;
