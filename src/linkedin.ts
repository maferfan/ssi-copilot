import type { Preview } from "./types";

const URL_RE = /https?:\/\/(?:[\w-]+\.)?(?:linkedin\.com|lnkd\.in)\/[^\s<>"]+/i;

/** Primeiro link do LinkedIn numa mensagem, já sem pontuação no fim. */
export function extractLinkedInUrl(text: string, entityUrls: string[] = []): string | null {
  for (const candidate of [...entityUrls, text]) {
    const m = candidate.match(URL_RE);
    if (m) return m[0].replace(/[).,;!?]+$/, "");
  }
  return null;
}

/** Texto que veio junto com o link (quando o usuário colou o post inteiro). */
export function textAroundUrl(text: string, url: string): string {
  return text.replace(url, "").trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  const reRev = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i");
  const m = html.match(re) ?? html.match(reRev);
  return m ? decodeEntities(m[1]).trim() : null;
}

/** Lê autor e texto da página pública de um post. Funciona só com HTML, sem rede. */
export function parsePostHtml(html: string): Preview {
  let text: string | null = null;
  let author: string | null = null;

  // 1) JSON-LD costuma trazer o texto completo e o autor
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data, ...(data["@graph"] ?? [])];
      for (const item of items) {
        if (!text && typeof item?.articleBody === "string") text = item.articleBody;
        if (!text && typeof item?.text === "string") text = item.text;
        const a = item?.author;
        if (!author && a) author = Array.isArray(a) ? a[0]?.name ?? null : a.name ?? null;
      }
    } catch {
      /* JSON-LD inválido: ignora */
    }
  }

  // 2) Metatags Open Graph como plano B
  const title = meta(html, "og:title");
  if (!text) text = meta(html, "og:description");
  if (!author && title) {
    const on = title.match(/^(.+?)\s+(?:on|no|em)\s+LinkedIn:/i);
    if (on) author = on[1];
    else {
      const parts = title.split(" | ");
      if (parts.length >= 3) author = parts[1];
    }
  }

  return { author: author?.trim() || null, text: text?.trim() || null };
}

/** Busca a prévia pública do post. Se o LinkedIn bloquear, devolve null e o bot pede o texto. */
export async function fetchPreview(url: string): Promise<Preview | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ssi-copilot/1.0)", "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const preview = parsePostHtml(await res.text());
    // Texto curto demais geralmente é o "Entre no LinkedIn" e não o post
    if (!preview.text || preview.text.length < 40) return null;
    return preview;
  } catch {
    return null;
  }
}
