import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import type { CarouselChart, CarouselContent, Reference, RenderedCarousel, Renderer } from "./types";

/** Tamanho de cada slide: quadrado, como o LinkedIn exibe carrosséis. */
export const SIZE = 1080;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Quebras de linha do texto viram <br>; **trecho** vira destaque dourado. */
function rich(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<em class="hl">$1</em>')
    .replace(/\n/g, "<br>");
}

/** Gráfico só entra se tiver de 2 a 8 valores numéricos. */
function validChart(g: CarouselChart | undefined): CarouselChart | undefined {
  if (!g || !Array.isArray(g.dados)) return undefined;
  const dados = g.dados
    .filter((d) => d && String(d.label ?? "").trim() && Number.isFinite(Number(d.valor)))
    .map((d) => ({ label: String(d.label).trim().slice(0, 40), valor: Number(d.valor) }))
    .slice(0, 8);
  if (dados.length < 2) return undefined;
  const fonte = !g.ilustrativo && g.fonte?.url ? { nome: g.fonte.nome.trim(), url: g.fonte.url.trim(), ano: String(g.fonte.ano ?? "").trim() } : null;
  return {
    tipo: g.tipo === "line" ? "line" : "bar",
    titulo: (g.titulo ?? "").trim(),
    unidade: (g.unidade ?? "").trim(),
    dados,
    fonte,
    ilustrativo: !fonte,
  };
}

/** Garante o formato que o modelo e o renderizador esperam. */
/** Capa + no máximo 3 slides de conteúdo + fechamento = até 5 slides (de preferência 3). */
export const MAX_CONTENT_SLIDES = 3;
/** Contando o da capa. */
export const MAX_CHARTS = 3;

export function normalizeCarousel(c: CarouselContent): CarouselContent {
  const slides = (c.slides ?? []).filter((s) => s?.titulo?.trim()).slice(0, MAX_CONTENT_SLIDES);
  if (!c.titulo?.trim() || slides.length < 1) throw new Error("O carrossel veio incompleto. Tente de novo.");
  const capa = validChart(c.capa_grafico);
  let charts = capa ? 1 : 0;
  const out: CarouselContent = {
    titulo: c.titulo.trim(),
    subtitulo: (c.subtitulo ?? "").trim(),
    ...(capa ? { capa_grafico: capa } : {}),
    slides: slides.map((s) => {
      let grafico = validChart(s.grafico);
      if (grafico && charts >= MAX_CHARTS) grafico = undefined;
      if (grafico) charts++;
      return { titulo: s.titulo.trim(), texto: (s.texto ?? "").trim(), ...(grafico ? { grafico } : {}) };
    }),
    fechamento: { titulo: (c.fechamento?.titulo ?? "What do you think?").trim(), texto: (c.fechamento?.texto ?? "").trim() },
    legenda: (c.legenda ?? "").trim(),
  };
  // Referências = fontes dos gráficos, sem repetir, na ordem em que aparecem
  const refs: Reference[] = [];
  for (const g of [out.capa_grafico, ...out.slides.map((s) => s.grafico)]) {
    const f = g?.fonte;
    if (f && !refs.some((r) => r.url === f.url)) refs.push(f);
  }
  if (refs.length) out.referencias = refs;
  if (c.custo) out.custo = c.custo;
  return out;
}

// ---------- gráficos dos slides (SVG) ----------

const CW = SIZE - 176; // largura útil do slide
const CH = 400;
const ACCENT = "#d6ac72";
const BONE = "#ece7de";
const MUTE = "rgba(236,231,222,0.45)";
const GRID = "rgba(236,231,222,0.12)";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export function fmtValue(v: number, unit: string): string {
  const n = nf.format(v);
  if (!unit) return n;
  return unit === "%" ? `${n}%` : `${n} ${unit}`;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/** Barras horizontais: rótulos longos cabem à esquerda, valor na ponta da barra. */
function barSvg(g: CarouselChart): string {
  const n = g.dados.length;
  const labelW = 300;
  const valueW = 130;
  const gap = 14;
  const rowH = Math.min(64, (CH - gap * (n - 1)) / n);
  const h = n * rowH + (n - 1) * gap;
  const max = Math.max(...g.dados.map((d) => d.valor), 0) || 1;
  const barMax = CW - labelW - valueW;
  const rows = g.dados
    .map((d, i) => {
      const y = i * (rowH + gap);
      const w = Math.max(4, (Math.max(0, d.valor) / max) * barMax);
      const r = Math.min(6, rowH / 2);
      return `<text x="${labelW - 18}" y="${y + rowH / 2 + 9}" text-anchor="end" class="c-label">${esc(d.label)}</text>
<path fill="${ACCENT}" d="M${labelW},${y} H${labelW + w - r} Q${labelW + w},${y} ${labelW + w},${y + r} V${y + rowH - r} Q${labelW + w},${y + rowH} ${labelW + w - r},${y + rowH} H${labelW} Z"/>
<text x="${labelW + w + 14}" y="${y + rowH / 2 + 9}" class="c-value">${esc(fmtValue(d.valor, g.unidade))}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${CW} ${h}" width="${CW}" height="${h}" role="img" aria-label="${esc(g.titulo)}">${rows}</svg>`;
}

/** Linha para séries no tempo: grade discreta, marcadores e valor no primeiro e no último ponto. */
function lineSvg(g: CarouselChart): string {
  const pad = { top: 40, right: 40, bottom: 56, left: 90 };
  const pw = CW - pad.left - pad.right;
  const ph = CH - pad.top - pad.bottom;
  const max = niceMax(Math.max(...g.dados.map((d) => d.valor)));
  const n = g.dados.length;
  const x = (i: number) => pad.left + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
  const y = (v: number) => pad.top + ph - (Math.max(0, v) / max) * ph;
  const grid = [0, max / 2, max]
    .map((v) => `<line x1="${pad.left}" x2="${CW - pad.right}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}" stroke-width="2"/><text x="${pad.left - 16}" y="${y(v) + 8}" text-anchor="end" class="c-tick">${esc(fmtValue(v, g.unidade))}</text>`)
    .join("");
  const path = g.dados.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.valor)}`).join(" ");
  const dots = g.dados.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.valor)}" r="8" fill="${ACCENT}" stroke="#141416" stroke-width="4"/>`).join("");
  const xl = g.dados.map((d, i) => `<text x="${x(i)}" y="${CH - 14}" text-anchor="middle" class="c-tick">${esc(d.label)}</text>`).join("");
  const ends = [0, n - 1]
    .map((i) => `<text x="${x(i)}" y="${y(g.dados[i].valor) - 22}" text-anchor="${i === 0 ? "start" : "end"}" class="c-value">${esc(fmtValue(g.dados[i].valor, g.unidade))}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}" role="img" aria-label="${esc(g.titulo)}">${grid}<path d="${path}" fill="none" stroke="${ACCENT}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>${dots}${xl}${ends}</svg>`;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const short = u.hostname.replace(/^www\./, "") + (path.length > 28 ? `${path.slice(0, 27)}…` : path);
    return short;
  } catch {
    return url.slice(0, 40);
  }
}

function chartBlock(g: CarouselChart): string {
  const caption = g.fonte
    ? `Source: ${esc(g.fonte.nome)}${g.fonte.ano ? ` (${esc(g.fonte.ano)})` : ""} · ${esc(shortUrl(g.fonte.url))}`
    : "Illustrative data, not a measurement";
  return `<figure class="chart">
  ${g.titulo ? `<figcaption class="c-title">${esc(g.titulo)}</figcaption>` : ""}
  ${g.tipo === "line" ? lineSvg(g) : barSvg(g)}
  <p class="c-source mono${g.fonte ? "" : " illustrative"}">${caption}</p>
</figure>`;
}

/** HTML com um slide por página, no visual do matheusferrazzadev.com. */
export function carouselHtml(c: CarouselContent): string {
  const total = c.slides.length + 2;
  const num = (i: number) => `${String(i).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  const frame = (i: number, body: string, cls = "") => `
<section class="slide ${cls}">
  <header><span class="mark">MF</span><span class="mono">${num(i)}</span></header>
  <div class="body">${body}</div>
  <footer><span>Matheus Ferrazza</span><span class="mono">matheusferrazzadev.com</span></footer>
</section>`;

  const content = c.slides.map((s, i) =>
    s.grafico
      ? frame(i + 2, `<p class="kicker mono">${String(i + 1).padStart(2, "0")}</p><h2 class="small">${rich(s.titulo)}</h2><p class="text small">${rich(s.texto)}</p>${chartBlock(s.grafico)}`, "with-chart")
      : frame(i + 2, `<p class="kicker mono">${String(i + 1).padStart(2, "0")}</p><h2>${rich(s.titulo)}</h2><p class="text">${rich(s.texto)}</p>`),
  );
  const cover = c.capa_grafico
    ? frame(1, `<h1 class="small">${rich(c.titulo)}</h1>${c.subtitulo ? `<p class="sub small">${rich(c.subtitulo)}</p>` : ""}${chartBlock(c.capa_grafico)}<p class="swipe mono">Swipe →</p>`, "cover with-chart")
    : frame(1, `<p class="kicker mono">Carousel</p><h1>${rich(c.titulo)}</h1>${c.subtitulo ? `<p class="sub">${rich(c.subtitulo)}</p>` : ""}<p class="swipe mono">Swipe →</p>`, "cover");

  const slides = [
    cover,
    ...content,
    frame(
      total,
      `<h2>${rich(c.fechamento.titulo)}</h2><p class="text">${rich(c.fechamento.texto)}</p><p class="cta mono">Follow for more like this</p>`,
      "closing",
    ),
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page { size: ${SIZE}px ${SIZE}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #0d0d0e; }
  .slide {
    width: ${SIZE}px; height: ${SIZE}px; padding: 88px; position: relative; overflow: hidden;
    display: flex; flex-direction: column; justify-content: space-between;
    background: radial-gradient(120% 80% at 100% 0%, #1c1c1f 0%, #0d0d0e 60%);
    color: ${BONE}; font-family: "Manrope", system-ui, sans-serif;
    page-break-after: always; break-after: page;
  }
  .slide::after { content: ""; position: absolute; inset: 40px; border: 1px solid rgba(236,231,222,0.1); pointer-events: none; }
  header, footer { display: flex; justify-content: space-between; align-items: center; font-size: 22px; color: rgba(236,231,222,0.62); }
  .mark { font-family: "Instrument Serif", serif; font-style: italic; font-size: 44px; color: ${BONE}; }
  .mono { font-family: "JetBrains Mono", monospace; letter-spacing: 0.04em; }
  .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 36px; }
  .with-chart .body { gap: 22px; justify-content: flex-start; padding-top: 28px; }
  .kicker { color: ${ACCENT}; font-size: 24px; text-transform: uppercase; }
  h1 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 112px; line-height: 1.02; letter-spacing: -0.01em; }
  h2 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 80px; line-height: 1.05; }
  h2.small { font-size: 60px; }
  .sub { font-size: 34px; line-height: 1.4; color: rgba(236,231,222,0.62); max-width: 820px; }
  .text { font-size: 36px; line-height: 1.5; color: rgba(236,231,222,0.82); max-width: 860px; }
  .text.small { font-size: 28px; line-height: 1.45; }
  .hl { font-style: normal; color: ${ACCENT}; }
  h1 .hl, h2 .hl { font-style: italic; }
  .swipe, .cta { color: ${ACCENT}; font-size: 24px; }
  .closing h2 { font-size: 96px; }
  .chart { display: flex; flex-direction: column; gap: 16px; margin-top: 8px; }
  .chart svg { display: block; overflow: visible; }
  .c-title { font-size: 24px; font-weight: 600; color: ${BONE}; }
  .c-label { fill: rgba(236,231,222,0.82); font: 500 24px "Manrope", sans-serif; }
  .c-value { fill: ${BONE}; font: 600 26px "Manrope", sans-serif; }
  .c-tick { fill: ${MUTE}; font: 400 20px "JetBrains Mono", monospace; }
  .c-source { font-size: 18px; color: ${MUTE}; }
  .c-source.illustrative { color: ${ACCENT}; }
  .cover.with-chart .body { justify-content: center; padding-top: 0; }
  h1.small { font-size: 76px; }
  .sub.small { font-size: 28px; }

</style></head>
<body>${slides.join("")}</body></html>`;
}

/** Gera o PDF e as imagens com o navegador da Cloudflare (Browser Run). */
export class BrowserRenderer implements Renderer {
  constructor(private browser: BrowserWorker) {}

  /** Uma nova tentativa se a primeira falhar (o navegador da Cloudflare às vezes demora para responder). */
  async render(c: CarouselContent): Promise<RenderedCarousel> {
    try {
      return await this.renderOnce(c);
    } catch {
      return await this.renderOnce(c);
    }
  }

  private async renderOnce(c: CarouselContent): Promise<RenderedCarousel> {
    const browser = await puppeteer.launch(this.browser);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
      // Não espera a rede ficar parada (o Google Fonts às vezes demora e estourava 30 s):
      // só o carregamento da página, e no máximo 8 s pelas fontes; sem elas, usa as de reserva
      await page.setContent(carouselHtml(c), { waitUntil: "load", timeout: 45_000 });
      await page.evaluate("Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))])");

      const pdf = await page.pdf({ width: `${SIZE}px`, height: `${SIZE}px`, printBackground: true, pageRanges: "" });
      const images: Uint8Array[] = [];
      for (const slide of await page.$$(".slide")) {
        images.push(new Uint8Array((await slide.screenshot({ type: "png" })) as Uint8Array));
      }
      return { pdf: new Uint8Array(pdf), images };
    } finally {
      await browser.close();
    }
  }
}
