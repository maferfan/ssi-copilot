/** Semanas de segunda a domingo, no horário de Brasília (UTC-3, sem horário de verão). */

const BRT_OFFSET_MS = 3 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** Segunda-feira da semana de `d`, como "AAAA-MM-DD". */
export function weekKey(d: Date): string {
  const b = new Date(d.getTime() - BRT_OFFSET_MS);
  const back = (b.getUTCDay() + 6) % 7;
  return new Date(b.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

/** Instante (UTC) em que a semana começa: segunda 00:00 em Brasília. */
export function weekStartInstant(key: string): Date {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + BRT_OFFSET_MS);
}

export function shiftWeek(key: string, weeks: number): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + weeks * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** As últimas `n` semanas, da mais antiga para a atual. */
export function lastWeeks(now: Date, n: number): string[] {
  const current = weekKey(now);
  return Array.from({ length: n }, (_, i) => shiftWeek(current, i - (n - 1)));
}

/** "03/11" a partir de "2026-11-03". */
export function weekLabel(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}
