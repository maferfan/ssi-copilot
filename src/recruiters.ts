import type { RecruiterCandidate } from "./types";

/** Quantos perfis por domingo. Fica bem abaixo do limite semanal de convites do LinkedIn (~100). */
export const WEEKLY_RECRUITERS = 50;
export const BATCH_SIZE = 10;
/** Contas gratuitas têm poucas notas personalizadas por mês: só os primeiros da semana recebem. */
export const NOTES_PER_WEEK = 5;

/** "https://br.linkedin.com/in/ana-souza-123/?trk=x" → "https://www.linkedin.com/in/ana-souza-123". */
export function normalizeProfileUrl(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* mantém como veio */
  }
  return `https://www.linkedin.com/in/${slug.toLowerCase()}`;
}

/** Só perfis em português ou inglês, sem repetidos e sem quem já foi sugerido antes. */
export function selectCandidates(cands: RecruiterCandidate[], known: string[], want: number): (RecruiterCandidate & { language: "pt" | "en" })[] {
  const seen = new Set(known.map((u) => normalizeProfileUrl(u) ?? u));
  const out: (RecruiterCandidate & { language: "pt" | "en" })[] = [];
  for (const c of cands) {
    const url = normalizeProfileUrl(c.url ?? "");
    const name = (c.name ?? "").trim();
    if (!url || !name || seen.has(url)) continue;
    if (c.language !== "pt" && c.language !== "en") continue;
    seen.add(url);
    out.push({ ...c, name, url, headline: (c.headline ?? "").trim(), language: c.language });
    if (out.length >= want) break;
  }
  return out;
}

/** Nota curta de agradecimento, no idioma do perfil. O LinkedIn limita notas a 200 caracteres. */
export function connectionNote(name: string, language: "pt" | "en"): string {
  const first = name.split(/\s+/)[0].replace(/[^\p{L}'-]/gu, "") || name;
  const note =
    language === "en"
      ? `Hi ${first}, I'm a web developer and I'd love to connect and follow your work in tech recruiting. Thanks in advance for connecting!`
      : `Olá, ${first}! Sou desenvolvedor web e gostaria de me conectar e acompanhar seu trabalho com recrutamento em tecnologia. Obrigado desde já pela conexão!`;
  return note.slice(0, 200);
}

/** Primeiro array JSON encontrado no texto (a busca na web devolve texto livre em volta). */
export function parseJsonArray<T>(text: string): T[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const data = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}
