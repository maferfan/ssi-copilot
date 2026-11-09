import type { Illustrator } from "./types";

export const FLUX_MODEL = "@cf/black-forest-labs/flux-1-schnell";

/** Estilo fixo: combina com o visual do site e evita texto na imagem (o Flux erra letras). */
export const STYLE =
  "Editorial illustration, cinematic lighting, dark charcoal background (#0d0d0e), warm gold accents (#d6ac72), " +
  "muted bone-white highlights, minimal composition, generous negative space, high detail. " +
  "No text, no letters, no numbers, no logos, no watermarks, no UI screenshots.";

export function fluxPrompt(scene: string): string {
  return `${scene.trim().replace(/\.?$/, ".")} ${STYLE}`;
}

/** Ilustração da capa com o Flux 1 Schnell do Workers AI (cota grátis diária da Cloudflare). */
export class FluxIllustrator implements Illustrator {
  constructor(private ai: Ai) {}

  async generate(scene: string): Promise<string | null> {
    if (!scene.trim()) return null;
    try {
      const out = await this.ai.run(FLUX_MODEL, { prompt: fluxPrompt(scene), steps: 8 });
      return out.image ? `data:image/jpeg;base64,${out.image}` : null;
    } catch (err) {
      console.error("ilustração falhou", err);
      return null;
    }
  }
}
