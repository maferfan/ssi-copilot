/**
 * Horários do cron (UTC). Precisam ser iguais aos de wrangler.toml; um teste confere.
 * A Cloudflare não aceita 0 para domingo no dia da semana: use SUN.
 */
export const CRONS = {
  /** 18h em Brasília: comentários todo dia, lembrete na véspera do carrossel, resumo no domingo */
  daily: "0 21 * * *",
  /** 8h30 em Brasília: post de imagem na terça, carrossel na quinta (PUBLISH_WEEKDAYS em bot.ts) */
  publish: "30 11 * * TUE,THU",
  /** 10h de sábado em Brasília: as 10 vagas da semana */
  jobs: "0 13 * * SAT",
  /** A cada minuto: fila de trabalhos longos pedidos pelo Telegram */
  queue: "* * * * *",
} as const;
