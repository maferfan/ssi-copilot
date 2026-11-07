import type { Preview } from "./types";

const URL_RE = /https?:\/\/(?:[\w-]+\.)?(?:linkedin\.com|lnkd\.in)\/[^\s<>"]+/i;

/** Páginas de login/cadastro para onde o LinkedIn manda quem não está logado. */
export function isLoginWall(url: string): boolean {
  return /linkedin\.com\/(signup|login|authwall|uas\/login|checkpoint)/i.test(url);
}

/**
 * Link de cadastro/login que embrulha o post ("signup/cold-join?session_redirect=<post>")
 * vira o link do post. Qualquer outro link volta como veio.
 */
export function unwrapLinkedInUrl(url: string): string {
  try {
    const u = new URL(url);
    const inner = u.searchParams.get("session_redirect") ?? u.searchParams.get("redirect");
    if (inner && /^https?:\/\/([\w-]+\.)?linkedin\.com\//i.test(inner) && !isLoginWall(inner)) return inner;
  } catch {
    /* não é um link válido */
  }
  return url;
}

/** Texto padrão das páginas públicas do LinkedIn ("Mais de 950 milhões de usuários..."), que não é o post. */
export function isBoilerplate(text: string | null): boolean {
  if (!text) return false;
  return /\d+\s*(milh(õ|o)es|million)\s+(de\s+)?(usu[aá]rios|members)|gerencie sua identidade profissional|manage your professional identity|(entre|cadastre-se) no linkedin|join linkedin|sign (in|up) (to|for) linkedin|log in or sign up/i.test(text);
}

/** Primeiro link do LinkedIn numa mensagem, já sem pontuação no fim e sem o embrulho de login. */
export function extractLinkedInUrl(text: string, entityUrls: string[] = []): string | null {
  for (const candidate of [...entityUrls, text]) {
    const m = candidate.match(URL_RE);
    if (m) return unwrapLinkedInUrl(m[0].replace(/[).,;!?]+$/, ""));
  }
  return null;
}

/**
 * Identificador do post para a API (urn:li:activity|share|ugcPost:ID).
 * Aceita links /feed/update/urn:li:...:ID e /posts/fulano_titulo-activity-ID-xxxx.
 */
export function extractPostUrn(url: string): string | null {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    /* link com % inválido: usa como veio */
  }
  const direct = decoded.match(/urn:li:(activity|share|ugcPost):(\d+)/);
  if (direct) return `urn:li:${direct[1]}:${direct[2]}`;
  const slug = decoded.match(/[-_](activity|share|ugcPost)-(\d{10,})/);
  if (slug) return `urn:li:${slug[1]}:${slug[2]}`;
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

/** Busca a prévia pública do post. Se o LinkedIn bloquear, vem sem texto e o bot pede para colar. */
export async function fetchPreview(url: string): Promise<Preview | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ssi-copilot/1.0)", "accept-language": "pt-BR,pt;q=0.9,en;q=0.8" },
      redirect: "follow",
    });
    const final = res.url || url;
    // Caiu na tela de login/cadastro: o texto é o da página do LinkedIn, não o do post
    if (isLoginWall(final)) return { author: null, text: null, url: unwrapLinkedInUrl(final) };
    // Mesmo bloqueado, o endereço final serve para achar o identificador do post
    if (!res.ok) return { author: null, text: null, url: final };
    const preview = parsePostHtml(await res.text());
    // Texto curto ou genérico ("Mais de 950 milhões de usuários...") não é o post
    if (!preview.text || preview.text.length < 40 || isBoilerplate(preview.text)) return { author: preview.author, text: null, url: final };
    return { ...preview, url: final };
  } catch {
    return null;
  }
}
