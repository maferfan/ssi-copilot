import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import type { CarouselContent, RenderedCarousel, Renderer } from "./types";

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

/** Garante o formato que o modelo e o renderizador esperam. */
export function normalizeCarousel(c: CarouselContent): CarouselContent {
  const slides = (c.slides ?? []).filter((s) => s?.titulo?.trim()).slice(0, 8);
  if (!c.titulo?.trim() || slides.length < 3) throw new Error("O carrossel veio incompleto. Tente de novo.");
  return {
    titulo: c.titulo.trim(),
    subtitulo: (c.subtitulo ?? "").trim(),
    slides: slides.map((s) => ({ titulo: s.titulo.trim(), texto: (s.texto ?? "").trim() })),
    fechamento: { titulo: (c.fechamento?.titulo ?? "Gostou?").trim(), texto: (c.fechamento?.texto ?? "").trim() },
    legenda: (c.legenda ?? "").trim(),
  };
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

  const slides = [
    frame(1, `<p class="kicker mono">Carrossel</p><h1>${rich(c.titulo)}</h1>${c.subtitulo ? `<p class="sub">${rich(c.subtitulo)}</p>` : ""}<p class="swipe mono">Deslize →</p>`, "cover"),
    ...c.slides.map((s, i) => frame(i + 2, `<p class="kicker mono">${String(i + 1).padStart(2, "0")}</p><h2>${rich(s.titulo)}</h2><p class="text">${rich(s.texto)}</p>`)),
    frame(total, `<h2>${rich(c.fechamento.titulo)}</h2><p class="text">${rich(c.fechamento.texto)}</p><p class="cta mono">Siga para mais conteúdos como este</p>`, "closing"),
  ];

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  @page { size: ${SIZE}px ${SIZE}px; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #0d0d0e; }
  .slide {
    width: ${SIZE}px; height: ${SIZE}px; padding: 88px; position: relative; overflow: hidden;
    display: flex; flex-direction: column; justify-content: space-between;
    background: radial-gradient(120% 80% at 100% 0%, #1c1c1f 0%, #0d0d0e 60%);
    color: #ece7de; font-family: "Manrope", system-ui, sans-serif;
    page-break-after: always; break-after: page;
  }
  .slide::after { content: ""; position: absolute; inset: 40px; border: 1px solid rgba(236,231,222,0.1); pointer-events: none; }
  header, footer { display: flex; justify-content: space-between; align-items: center; font-size: 22px; color: rgba(236,231,222,0.62); }
  .mark { font-family: "Instrument Serif", serif; font-style: italic; font-size: 44px; color: #ece7de; }
  .mono { font-family: "JetBrains Mono", monospace; letter-spacing: 0.04em; }
  .body { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 36px; }
  .kicker { color: #d6ac72; font-size: 24px; text-transform: uppercase; }
  h1 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 112px; line-height: 1.02; letter-spacing: -0.01em; }
  h2 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 80px; line-height: 1.05; }
  .sub { font-size: 34px; line-height: 1.4; color: rgba(236,231,222,0.62); max-width: 820px; }
  .text { font-size: 36px; line-height: 1.5; color: rgba(236,231,222,0.82); max-width: 860px; }
  .hl { font-style: normal; color: #d6ac72; }
  h1 .hl, h2 .hl { font-style: italic; }
  .swipe, .cta { color: #d6ac72; font-size: 24px; }
  .closing h2 { font-size: 96px; }
</style></head>
<body>${slides.join("")}</body></html>`;
}

/** Gera o PDF e as imagens com o navegador da Cloudflare (Browser Run). */
export class BrowserRenderer implements Renderer {
  constructor(private browser: BrowserWorker) {}

  async render(c: CarouselContent): Promise<RenderedCarousel> {
    const browser = await puppeteer.launch(this.browser);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });
      await page.setContent(carouselHtml(c), { waitUntil: "networkidle0" });
      await page.evaluate("document.fonts.ready");

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
