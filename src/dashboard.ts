import type { Carousel, Store, WeeklyMetrics } from "./types";
import { lastWeeks, weekKey, weekLabel, weekStartInstant } from "./week";

export const DASHBOARD_WEEKS = 12;

export interface WeekRow {
  week: string;
  comment: number;
  post: number;
  invite: number;
  metrics: WeeklyMetrics | null;
}

export interface DashboardData {
  weeks: WeekRow[];
  carousels: Carousel[];
  generatedAt: string;
}

export async function loadDashboard(store: Store, now: Date): Promise<DashboardData> {
  const keys = lastWeeks(now, DASHBOARD_WEEKS);
  const [actions, metrics, carousels] = await Promise.all([
    store.listActionsSince(weekStartInstant(keys[0]).toISOString()),
    store.listMetrics(keys[0]),
    store.listCarousels(["published"]),
  ]);
  const byWeek = new Map(keys.map((k) => [k, { week: k, comment: 0, post: 0, invite: 0, metrics: null } as WeekRow]));
  for (const a of actions) {
    const row = byWeek.get(weekKey(new Date(a.created_at)));
    if (row && (a.type === "comment" || a.type === "post" || a.type === "invite")) row[a.type]++;
  }
  for (const m of metrics) {
    const row = byWeek.get(m.week);
    if (row) row.metrics = m;
  }
  return { weeks: [...byWeek.values()], carousels: carousels.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")).slice(0, 6), generatedAt: now.toISOString() };
}

// ---------- formatação ----------

const nf = new Intl.NumberFormat("pt-BR");
const fmt = (n: number) => nf.format(n);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Topo "redondo" do eixo: 1, 2, 5 × 10^n. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

// ---------- gráficos (SVG no servidor) ----------

const W = 320;
const H = 150;
const PAD = { top: 14, right: 10, bottom: 22, left: 34 };
const PW = W - PAD.left - PAD.right;
const PH = H - PAD.top - PAD.bottom;

function frame(max: number, labels: string[], body: string, title: string): string {
  const y = (v: number) => PAD.top + PH - (v / max) * PH;
  // Linha do meio só quando cai num número inteiro (evita "0, 1, 1" com máximo 1)
  const grid = (Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max])
    .map((v) => `<line class="grid" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${PAD.left - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(Math.round(v))}</text>`)
    .join("");
  const band = PW / labels.length;
  // Só três rótulos no eixo x: primeira, do meio e atual
  const xl = [0, Math.floor((labels.length - 1) / 2), labels.length - 1]
    .map((i) => `<text class="tick" x="${PAD.left + band * (i + 0.5)}" y="${H - 6}" text-anchor="middle">${labels[i]}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${body}${xl}</svg>`;
}

/** Barras verticais, uma por semana. `unit` aparece na dica: "12 comentários". */
export function barChart(title: string, weeks: string[], values: number[], unit: [string, string]): string {
  const max = niceMax(Math.max(...values));
  const band = PW / weeks.length;
  const bw = Math.max(4, band - 6);
  const cols = values
    .map((v, i) => {
      const x = PAD.left + band * i + (band - bw) / 2;
      const h = (v / max) * PH;
      const r = Math.min(4, h, bw / 2);
      const base = PAD.top + PH;
      const top = base - h;
      const bar =
        v > 0
          ? `<path class="mark" d="M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${base} Z"/>`
          : "";
      const tip = `Semana de ${weekLabel(weeks[i])}: ${fmt(v)} ${v === 1 ? unit[0] : unit[1]}`;
      return `<g class="col" data-tip="${esc(tip)}"><title>${esc(tip)}</title><rect class="hit" x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${PH}"/>${bar}</g>`;
    })
    .join("");
  return frame(max, weeks.map(weekLabel), cols, title);
}

/** Linha com marcadores; semanas sem número viram lacuna na linha. */
export function lineChart(title: string, weeks: string[], values: (number | null)[], unit: string): string {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return `<div class="empty">Ainda sem números. Mande <code>/metricas</code> no bot no domingo.</div>`;
  }
  const max = niceMax(Math.max(...present));
  const band = PW / weeks.length;
  const x = (i: number) => PAD.left + band * (i + 0.5);
  const y = (v: number) => PAD.top + PH - (v / max) * PH;

  let d = "";
  values.forEach((v, i) => {
    if (v === null) return;
    d += `${values[i - 1] == null ? "M" : "L"}${x(i)},${y(v)} `;
  });
  const lastIdx = values.map((v) => v !== null).lastIndexOf(true);
  const dots = values
    .map((v, i) => {
      const tip = v === null ? `Semana de ${weekLabel(weeks[i])}: sem número` : `Semana de ${weekLabel(weeks[i])}: ${fmt(v)} ${unit}`;
      const dot = v === null ? "" : `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4"/>`;
      return `<g class="col" data-tip="${esc(tip)}"><title>${esc(tip)}</title><rect class="hit" x="${PAD.left + band * i}" y="${PAD.top}" width="${band}" height="${PH}"/>${dot}</g>`;
    })
    .join("");
  const label = `<text class="direct" x="${x(lastIdx) - 8}" y="${y(values[lastIdx]!) - 10}" text-anchor="end">${fmt(values[lastIdx]!)}</text>`;
  return frame(max, weeks.map(weekLabel), `<path class="line" d="${d.trim()}"/>${dots}${label}`, title);
}

// ---------- página ----------

function delta(cur: number | undefined, prev: number | undefined): string {
  if (cur === undefined || prev === undefined) return "";
  const diff = cur - prev;
  if (diff === 0) return `<span class="delta">igual à semana anterior</span>`;
  const sign = diff > 0 ? "+" : "−";
  return `<span class="delta">${sign}${fmt(Math.abs(diff))} vs. semana anterior</span>`;
}

function tile(label: string, value: string, sub = ""): string {
  return `<div class="tile"><span class="tile-label">${label}</span><span class="tile-value">${value}</span>${sub}</div>`;
}

export function dashboardHtml(data: DashboardData): string {
  const weeks = data.weeks.map((w) => w.week);
  const cur = data.weeks.at(-1)!;
  const prev = data.weeks.at(-2);
  const withMetrics = data.weeks.filter((w) => w.metrics);
  const lastM = withMetrics.at(-1)?.metrics;
  const prevM = withMetrics.at(-2)?.metrics;
  const total = (k: "comment" | "post" | "invite") => data.weeks.reduce((s, w) => s + w[k], 0);

  const card = (title: string, sub: string, chart: string) =>
    `<figure class="card"><figcaption><span class="card-title">${title}</span><span class="card-sub">${sub}</span></figcaption>${chart}</figure>`;

  const rows = data.weeks
    .map(
      (w) =>
        `<tr><td>${weekLabel(w.week)}</td><td>${w.comment}</td><td>${w.post}</td><td>${w.invite}</td><td>${w.metrics ? fmt(w.metrics.profile_views) : "—"}</td><td>${w.metrics ? fmt(w.metrics.impressions) : "—"}</td><td>${w.metrics ? fmt(w.metrics.followers) : "—"}</td></tr>`,
    )
    .join("");

  const carousels = data.carousels.length
    ? `<ul class="list">${data.carousels
        .map(
          (c) =>
            `<li><span class="mono">${c.published_at ? weekLabel(c.published_at.slice(0, 10)) : ""}</span>${c.post_url ? `<a href="${esc(c.post_url)}" rel="noopener">${esc(c.content.titulo.replace(/\*\*/g, ""))}</a>` : esc(c.content.titulo.replace(/\*\*/g, ""))}</li>`,
        )
        .join("")}</ul>`
    : `<p class="muted">Nenhum carrossel publicado ainda.</p>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SSI Copilot · Painel</title>
<meta name="description" content="Constância no LinkedIn em números: ações da semana e resultado no perfil.">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --ink:#0d0d0e; --surface:#141416; --line:rgba(236,231,222,.1); --bone:#ece7de; --dim:rgba(236,231,222,.62); --mute:rgba(236,231,222,.38); --accent:#d6ac72; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--ink); color:var(--bone); font:16px/1.5 "Manrope",system-ui,sans-serif; padding:48px 16px 64px; }
  main { max-width:1080px; margin:0 auto; display:grid; gap:40px; }
  h1 { font:400 clamp(40px,7vw,64px)/1.05 "Instrument Serif",serif; }
  h1 em { color:var(--accent); }
  h2 { font:400 30px/1.2 "Instrument Serif",serif; margin-bottom:16px; }
  .lead { color:var(--dim); max-width:640px; margin-top:12px; }
  .mono, .tick, .card-sub, .tile-label, .delta { font-family:"JetBrains Mono",monospace; }
  .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
  .tile, .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:20px; }
  .tile { display:flex; flex-direction:column; gap:4px; }
  .tile-label { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); }
  .tile-value { font:400 44px/1.1 "Instrument Serif",serif; }
  .delta { font-size:12px; color:var(--mute); }
  .grid3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
  figcaption { display:flex; justify-content:space-between; align-items:baseline; gap:8px; margin-bottom:8px; }
  .card-title { font-weight:600; }
  .card-sub { font-size:12px; color:var(--mute); }
  svg { width:100%; height:auto; display:block; overflow:visible; }
  .grid { stroke:var(--line); stroke-width:1; }
  .tick { fill:var(--mute); font-size:9px; }
  .mark { fill:var(--accent); }
  .line { fill:none; stroke:var(--accent); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
  .dot { fill:var(--accent); stroke:var(--surface); stroke-width:2; }
  .direct { fill:var(--bone); font:600 11px "Manrope",sans-serif; }
  .hit { fill:transparent; }
  .col:hover .hit { fill:rgba(236,231,222,.05); }
  .col:hover .mark, .col:hover .dot { fill:var(--bone); }
  .empty { color:var(--mute); font-size:14px; padding:40px 0; text-align:center; }
  .list { list-style:none; display:grid; gap:10px; }
  .list li { display:flex; gap:16px; align-items:baseline; }
  .list .mono { color:var(--mute); font-size:13px; min-width:44px; }
  a { color:var(--bone); text-decoration-color:var(--accent); text-underline-offset:3px; }
  .muted { color:var(--mute); }
  details { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:16px 20px; }
  summary { cursor:pointer; color:var(--dim); }
  .table-wrap { overflow-x:auto; margin-top:12px; }
  table { border-collapse:collapse; width:100%; font-size:14px; font-variant-numeric:tabular-nums; }
  th, td { text-align:right; padding:6px 10px; border-bottom:1px solid var(--line); white-space:nowrap; }
  th:first-child, td:first-child { text-align:left; }
  th { color:var(--dim); font-weight:500; }
  footer { color:var(--mute); font-size:13px; }
  #tip { position:fixed; pointer-events:none; background:var(--bone); color:var(--ink); font:500 12px "Manrope",sans-serif; padding:6px 10px; border-radius:6px; opacity:0; transition:opacity .1s; }
</style></head>
<body><main>
  <header>
    <p class="mono muted">SSI Copilot · últimas ${DASHBOARD_WEEKS} semanas</p>
    <h1>Constância no LinkedIn, <em>em números</em></h1>
    <p class="lead">Um bot no Telegram sugere comentários e monta carrosséis; eu aprovo e ele publica. Primeiro, o que eu fiz; depois, o que voltou em alcance.</p>
  </header>

  <section>
    <h2>Esta semana</h2>
    <div class="tiles">
      ${tile("Comentários", fmt(cur.comment), delta(cur.comment, prev?.comment))}
      ${tile("Carrosséis", fmt(cur.post), delta(cur.post, prev?.post))}
      ${tile("Convites", fmt(cur.invite), delta(cur.invite, prev?.invite))}
      ${tile("Visualizações do perfil", lastM ? fmt(lastM.profile_views) : "—", lastM ? delta(lastM.profile_views, prevM?.profile_views) : '<span class="delta">aguardando /metricas</span>')}
    </div>
  </section>

  <section>
    <h2>O que eu fiz</h2>
    <div class="grid3">
      ${card("Comentários", `${fmt(total("comment"))} no período`, barChart("Comentários por semana", weeks, data.weeks.map((w) => w.comment), ["comentário", "comentários"]))}
      ${card("Carrosséis publicados", `${fmt(total("post"))} no período`, barChart("Carrosséis por semana", weeks, data.weeks.map((w) => w.post), ["carrossel", "carrosséis"]))}
      ${card("Convites a recrutadores", `${fmt(total("invite"))} no período`, barChart("Convites por semana", weeks, data.weeks.map((w) => w.invite), ["convite", "convites"]))}
    </div>
  </section>

  <section>
    <h2>O que voltou</h2>
    <div class="grid3">
      ${card("Visualizações do perfil", "por semana", lineChart("Visualizações do perfil por semana", weeks, data.weeks.map((w) => w.metrics?.profile_views ?? null), "visualizações"))}
      ${card("Impressões dos posts", "por semana", lineChart("Impressões por semana", weeks, data.weeks.map((w) => w.metrics?.impressions ?? null), "impressões"))}
      ${card("Seguidores", "total no domingo", lineChart("Seguidores", weeks, data.weeks.map((w) => w.metrics?.followers ?? null), "seguidores"))}
    </div>
  </section>

  <section>
    <h2>Carrosséis publicados</h2>
    ${carousels}
  </section>

  <details>
    <summary>Ver os números em tabela</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Semana</th><th>Comentários</th><th>Carrosséis</th><th>Convites</th><th>Visualizações</th><th>Impressões</th><th>Seguidores</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </details>

  <footer>
    <p>O LinkedIn deixou de mostrar o Social Selling Index (SSI) para contas sem Sales Navigator; por isso o painel acompanha visualizações, impressões e seguidores, copiados toda semana das Análises do perfil.</p>
    <p>Atualizado em ${new Date(data.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · <a href="https://github.com/maferfan/ssi-copilot">código no GitHub</a></p>
  </footer>
</main>
<div id="tip" role="tooltip"></div>
<script>
  const tip = document.getElementById("tip");
  document.querySelectorAll("[data-tip]").forEach((el) => {
    el.querySelector("title")?.remove();
    el.addEventListener("pointermove", (e) => {
      tip.textContent = el.dataset.tip;
      tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + "px";
      tip.style.top = e.clientY - 36 + "px";
      tip.style.opacity = 1;
    });
    el.addEventListener("pointerleave", () => (tip.style.opacity = 0));
  });
</script>
</body></html>`;
}
