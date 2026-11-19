import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import { imagePostHtml, POST_HEIGHT, POST_WIDTH } from "./imagepost";
import type { PostContent, Renderer } from "./types";

/** Desenha a arte do post (HTML → PNG) com o navegador da Cloudflare (Browser Run). */
export class BrowserRenderer implements Renderer {
  constructor(private browser: BrowserWorker) {}

  /** Uma nova tentativa se a primeira falhar (o navegador da Cloudflare às vezes demora para responder). */
  async render(c: PostContent): Promise<Uint8Array> {
    try {
      return await this.renderOnce(c);
    } catch {
      return await this.renderOnce(c);
    }
  }

  private async renderOnce(c: PostContent): Promise<Uint8Array> {
    const browser = await puppeteer.launch(this.browser);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: POST_WIDTH, height: POST_HEIGHT, deviceScaleFactor: 1 });
      // Não espera a rede ficar parada (o Google Fonts às vezes demora e estourava 30 s):
      // só o carregamento da página, e no máximo 8 s pelas fontes; sem elas, usa as de reserva
      await page.setContent(imagePostHtml(c), { waitUntil: "load", timeout: 45_000 });
      await page.evaluate("Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))])");
      const shot = (await (await page.$(".post"))!.screenshot({ type: "png" })) as Uint8Array;
      return new Uint8Array(shot);
    } finally {
      await browser.close();
    }
  }
}
