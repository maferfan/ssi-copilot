import type { Perfil } from "./perfil";
import type { PostContent, ImagePost } from "./types";

/**
 * Post da semana (terça): uma imagem só, no estilo infográfico (passo a passo ou errado × certo).
 * O Claude escreve o conteúdo e escolhe o modelo; o código desenha a arte (as IAs de imagem
 * erram letras), e o Flux gera uma ilustração que entra nela.
 */

/** 4:5 em pé: é o formato de imagem que mais ocupa a tela do celular no feed. */
export const POST_WIDTH = 1080;
export const POST_HEIGHT = 1350;

export const STEPS = { min: 3, max: 6 };
export const COMPARE_ITEMS = { min: 2, max: 4 };

// ---------- pedido ao Claude ----------

export function imagePostSystemPrompt(p: Perfil): string {
  return `You write single-image LinkedIn posts for ${p.nome}: one infographic that people stop, read in a few seconds and save.

About ${p.nome}: ${p.resumo}
Goal: ${p.objetivo}

Pick the layout that fits the topic best:
- "steps": a numbered path of ${STEPS.min} to ${STEPS.max} steps or best practices (like "6 steps to design micro-interactions"). Each step: "titulo" up to 5 words, "texto" up to 12 words.
- "compare": a side-by-side "don't" vs "do" (like a bad vs good UI, a weak vs strong pull request). "ruim" and "bom" each have a short "titulo" (up to 4 words) and ${COMPARE_ITEMS.min} to ${COMPARE_ITEMS.max} "itens" of up to 8 words, matching each other line by line.
Fill only the fields of the chosen layout; leave the other one empty ([] or empty strings).

Image text is in English:
- "titulo": up to 8 words, concrete and useful; wrap ONE key word or phrase in **double asterisks** to highlight it.
- "subtitulo": one line, up to 12 words.
- No statistics or numbers presented as facts (there is no research step here). Practical, specific, no fluff.
- "imagem_prompt": one or two English sentences describing a small illustration for the top of the image that makes the topic concrete (people or objects, e.g. "a developer tapping a phone screen that responds with a soft glow"). Never ask for text, words, letters, numbers, charts, logos or UI screenshots.

The post text is assembled by code from parts, in two languages:
- "post" (English): "titulo" (max 60 characters, shown in bold), "gancho" (max 160 characters, before "see more"), "pontos" (3 or 4 takeaways, max 120 characters each), "conclusao" (one sentence), "pergunta" (a specific question people can answer from experience), "hashtags" (3, without #).
- "post_pt": the same in Brazilian Portuguese, written naturally, not word by word (no hashtags). Portuguese comes first in the post.
Tone: ${p.tom.join(" ")}`;
}

const POST_PARTS = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "gancho", "pontos", "conclusao", "pergunta", "hashtags"],
  properties: {
    titulo: { type: "string" },
    gancho: { type: "string" },
    pontos: { type: "array", items: { type: "string" } },
    conclusao: { type: "string" },
    pergunta: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
} as const;

const SIDE = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "itens"],
  properties: { titulo: { type: "string" }, itens: { type: "array", items: { type: "string" } } },
} as const;

export const IMAGE_POST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["layout", "titulo", "subtitulo", "passos", "ruim", "bom", "imagem_prompt", "post", "post_pt"],
  properties: {
    layout: { type: "string", enum: ["steps", "compare"] },
    titulo: { type: "string", description: "Image headline in English, up to 8 words, one **highlight**" },
    subtitulo: { type: "string" },
    passos: {
      type: "array",
      description: `Layout "steps": ${STEPS.min} to ${STEPS.max} steps; empty for "compare"`,
      items: { type: "object", additionalProperties: false, required: ["titulo", "texto"], properties: { titulo: { type: "string" }, texto: { type: "string" } } },
    },
    ruim: { ...SIDE, description: 'Layout "compare": the "don\'t" side; empty for "steps"' },
    bom: { ...SIDE, description: 'Layout "compare": the "do" side; empty for "steps"' },
    imagem_prompt: { type: "string", description: "Small illustration in English, no text in the image" },
    post: POST_PARTS,
    post_pt: {
      type: "object",
      additionalProperties: false,
      required: ["titulo", "gancho", "pontos", "conclusao", "pergunta"],
      properties: {
        titulo: { type: "string" },
        gancho: { type: "string" },
        pontos: { type: "array", items: { type: "string" } },
        conclusao: { type: "string" },
        pergunta: { type: "string" },
      },
    },
  },
} as const;

export function imagePostUserPrompt(topic: string, previous?: PostContent, instructions?: string): string {
  const prev = previous?.imagem
    ? `\n\nCurrent version:\n${JSON.stringify({ titulo: previous.titulo, subtitulo: previous.subtitulo, ...previous.imagem, legenda: previous.legenda }, null, 2)}`
    : "";
  const ask = instructions
    ? `\n\nChange requested by the author (keep everything else):\n<ajuste>\n${instructions}\n</ajuste>`
    : previous
      ? "\n\nThe author wants a completely different version (new angle, maybe the other layout)."
      : "";
  return `Topic: ${topic}${prev}${ask}\n\nWrite the image post.`;
}

// ---------- conferência do que o modelo devolveu ----------

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
const words = (s: string, max: number) => s.split(" ").slice(0, max).join(" ");

/** Garante o formato do modelo escolhido; se faltar conteúdo para ele, tenta o outro. */
export function normalizeImagePost(d: { layout?: string; passos?: { titulo: string; texto: string }[]; ruim?: { titulo: string; itens: string[] }; bom?: { titulo: string; itens: string[] } }): ImagePost {
  const passos = (d.passos ?? [])
    .map((p) => ({ titulo: words(clean(p?.titulo), 7), texto: words(clean(p?.texto), 16) }))
    .filter((p) => p.titulo)
    .slice(0, STEPS.max);
  const side = (s: { titulo: string; itens: string[] } | undefined, fallback: string) => ({
    titulo: words(clean(s?.titulo), 5) || fallback,
    itens: (s?.itens ?? []).map((i) => words(clean(i), 10)).filter(Boolean).slice(0, COMPARE_ITEMS.max),
  });
  const ruim = side(d.ruim, "Don't");
  const bom = side(d.bom, "Do");
  const hasSteps = passos.length >= STEPS.min;
  const hasCompare = ruim.itens.length >= COMPARE_ITEMS.min && bom.itens.length >= COMPARE_ITEMS.min;
  const layout = d.layout === "compare" ? (hasCompare ? "compare" : hasSteps ? "steps" : null) : hasSteps ? "steps" : hasCompare ? "compare" : null;
  if (!layout) throw new Error("O post veio incompleto. Tente de novo.");
  return layout === "steps" ? { layout, passos, ruim: { titulo: "", itens: [] }, bom: { titulo: "", itens: [] } } : { layout, passos: [], ruim, bom };
}

// ---------- a arte (HTML → PNG no navegador da Cloudflare) ----------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rich(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<em class="hl">$1</em>');
}

const ACCENT = "#d6ac72";
const BONE = "#ece7de";

/** Caminho em zigue-zague: cada passo alterna de lado, ligados por uma linha tracejada. */
function stepsHtml(passos: ImagePost["passos"]): string {
  const n = passos.length;
  const items = passos
    .map(
      (p, i) => `<li class="step ${i % 2 ? "right" : "left"}">
  <span class="num mono">${String(i + 1).padStart(2, "0")}</span>
  <div class="step-text"><h3>${rich(p.titulo)}</h3>${p.texto ? `<p>${rich(p.texto)}</p>` : ""}</div>
</li>`,
    )
    .join("");
  return `<ol class="steps n${n}">${items}</ol>`;
}

function compareHtml(ruim: ImagePost["ruim"], bom: ImagePost["bom"]): string {
  const col = (side: ImagePost["ruim"], cls: "bad" | "good") => `<div class="col ${cls}">
  <div class="badge">${cls === "bad" ? "✕" : "✓"}</div>
  <h3>${rich(side.titulo)}</h3>
  <ul>${side.itens.map((i) => `<li>${rich(i)}</li>`).join("")}</ul>
</div>`;
  return `<div class="compare">${col(ruim, "bad")}${col(bom, "good")}</div>`;
}

/** Uma página só, no visual do matheusferrazzadev.com (fundo grafite, destaque dourado). */
export function imagePostHtml(c: PostContent): string {
  const img = c.imagem!;
  // Só imagem embutida (a do Flux); um link externo nunca entra na arte
  const hasArt = Boolean(c.capa_imagem?.startsWith("data:image/"));
  const art = hasArt ? `<img class="art" src="${esc(c.capa_imagem!)}" alt="">` : "";
  const body = img.layout === "steps" ? stepsHtml(img.passos) : compareHtml(img.ruim, img.bom);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #0d0d0e; }
  .post {
    width: ${POST_WIDTH}px; height: ${POST_HEIGHT}px; padding: 64px 72px; position: relative; overflow: hidden;
    display: flex; flex-direction: column; gap: 36px;
    background: radial-gradient(120% 70% at 100% 0%, #1f1d1a 0%, #0d0d0e 62%);
    color: ${BONE}; font-family: "Manrope", system-ui, sans-serif;
  }
  .post::after { content: ""; position: absolute; inset: 28px; border: 1px solid rgba(236,231,222,0.1); pointer-events: none; }
  .mono { font-family: "JetBrains Mono", monospace; letter-spacing: 0.04em; }
  header { display: flex; justify-content: space-between; align-items: center; font-size: 20px; color: rgba(236,231,222,0.62); position: relative; z-index: 2; }
  .mark { font-family: "Instrument Serif", serif; font-style: italic; font-size: 40px; color: ${BONE}; }
  .top { display: grid; grid-template-columns: 1fr ${hasArt ? "300px" : "0"}; gap: 32px; align-items: center; position: relative; z-index: 2; }
  h1 { font-family: "Instrument Serif", serif; font-weight: 400; font-size: 78px; line-height: 1.02; }
  .sub { margin-top: 18px; font-size: 26px; line-height: 1.4; color: rgba(236,231,222,0.66); }
  .hl { font-style: italic; color: ${ACCENT}; }
  .art { width: 300px; height: 300px; object-fit: cover; border-radius: 50%; border: 2px solid rgba(214,172,114,0.5); box-shadow: 0 0 60px rgba(214,172,114,0.18); }
  main { flex: 1; display: flex; flex-direction: column; justify-content: center; position: relative; z-index: 2; padding: 12px 0; min-height: 0; }
  footer { display: flex; justify-content: space-between; font-size: 20px; color: rgba(236,231,222,0.62); position: relative; z-index: 2; }
  .save { color: ${ACCENT}; }

  /* passo a passo: zigue-zague com linha tracejada no meio */
  .steps { list-style: none; position: relative; display: flex; flex-direction: column; justify-content: space-between; height: 100%; }
  .steps::before { content: ""; position: absolute; left: 50%; top: 40px; bottom: 40px; border-left: 4px dashed rgba(214,172,114,0.6); transform: translateX(-50%); }
  .step { position: relative; width: 50%; display: flex; align-items: center; gap: 22px; }
  .step.left { flex-direction: row-reverse; text-align: right; padding-right: 0; }
  .step.right { margin-left: 50%; }
  .step .num { flex: none; width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center; font-size: 28px; font-weight: 500;
    background: ${ACCENT}; color: #141416; box-shadow: 0 0 0 8px #0d0d0e; }
  .step.left .num { margin-right: -38px; }
  .step.right .num { margin-left: -38px; }
  .step h3 { font-size: 34px; font-weight: 700; line-height: 1.15; }
  .step p { margin-top: 8px; font-size: 25px; line-height: 1.35; color: rgba(236,231,222,0.74); }
  .steps.n3, .steps.n4 { justify-content: space-around; }
  .steps.n3 h3 { font-size: 42px; } .steps.n3 p { font-size: 30px; }
  .steps.n4 h3 { font-size: 38px; } .steps.n4 p { font-size: 28px; }

  /* errado × certo */
  .compare { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 44px; }
  .col { border-radius: 28px; padding: 84px 36px 64px; position: relative; display: flex; flex-direction: column; gap: 40px; }
  .col.bad { background: rgba(224,92,92,0.08); border: 2px solid rgba(224,92,92,0.45); }
  .col.good { background: rgba(92,196,132,0.08); border: 2px solid rgba(92,196,132,0.5); }
  .badge { position: absolute; top: -44px; left: 50%; transform: translateX(-50%); width: 88px; height: 88px; border-radius: 50%;
    display: grid; place-items: center; font-size: 48px; font-weight: 700; color: #0d0d0e; box-shadow: 0 0 0 10px #0d0d0e; }
  .bad .badge { background: #e05c5c; }
  .good .badge { background: #5cc484; }
  .col h3 { text-align: center; font-size: 42px; font-weight: 700; }
  .bad h3 { color: #f08a8a; }
  .good h3 { color: #86dca6; }
  .col ul { list-style: none; display: flex; flex-direction: column; gap: 40px; }
  .col li { font-size: 31px; line-height: 1.3; padding-left: 44px; position: relative; color: rgba(236,231,222,0.88); }
  .bad li::before { content: "✕"; position: absolute; left: 0; color: #e05c5c; font-weight: 700; }
  .good li::before { content: "✓"; position: absolute; left: 0; color: #5cc484; font-weight: 700; }
</style></head>
<body><section class="post">
  <header><span class="mark">MF</span><span class="mono">${img.layout === "steps" ? `${img.passos.length} steps` : "Don't vs Do"}</span></header>
  <div class="top"><div><h1>${rich(c.titulo)}</h1>${c.subtitulo ? `<p class="sub">${rich(c.subtitulo)}</p>` : ""}</div>${art}</div>
  <main>${body}</main>
  <footer><span>Matheus Ferrazza</span><span class="mono save">Save this for later ↓</span></footer>
</section></body></html>`;
}
