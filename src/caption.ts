/** Partes do texto do post; o código monta sempre no mesmo formato. */
export interface PostParts {
  titulo: string;
  gancho: string;
  pontos: string[];
  conclusao: string;
  pergunta: string;
  hashtags: string[];
}

/** O mesmo texto em outra língua (as hashtags são as da versão em inglês). */
export type PostTextParts = Omit<PostParts, "hashtags">;

/** O LinkedIn não tem negrito: usa as letras "Mathematical Sans-Serif Bold" do Unicode. */
export function boldUnicode(text: string): string {
  return [...text]
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d5d4 + c - 65); // A-Z
      if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d5ee + c - 97); // a-z
      if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ec + c - 48); // 0-9
      return ch;
    })
    .join("");
}

const clean = (s: string | undefined) => (s ?? "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();

/** Limite do LinkedIn para o texto do post. */
export const CAPTION_LIMIT = 3000;

/** Um bloco de texto: título em negrito, gancho, pontos em lista, conclusão e pergunta. */
function block(p: PostTextParts, pontos: string[], flag = ""): string {
  return [
    `${flag}${boldUnicode(clean(p.titulo))}`,
    clean(p.gancho),
    pontos.map((x) => `→ ${x}`).join("\n"),
    clean(p.conclusao),
    p.pergunta ? `👉 ${clean(p.pergunta)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const pointsOf = (p: PostTextParts | undefined) => (p?.pontos ?? []).map(clean).filter(Boolean).slice(0, 5);

/**
 * Título em negrito, gancho (o que aparece antes do "…ver mais"), pontos em lista,
 * conclusão, pergunta para puxar comentários e hashtags.
 * Com `pt`, o post sai nas duas línguas: português primeiro (a rede é brasileira), depois inglês.
 */
export function buildCaption(en: PostParts, pt?: PostTextParts): string {
  const tags = (en.hashtags ?? [])
    .map((t) => clean(t).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => `#${t}`);
  const bilingual = Boolean(pt && clean(pt.titulo) && clean(pt.gancho));
  let enPts = pointsOf(en);
  let ptPts = pointsOf(pt);
  const build = () =>
    [
      bilingual ? block(pt!, ptPts, "🇧🇷 ") : "",
      bilingual ? "— — —" : "",
      block(en, enPts, bilingual ? "🇺🇸 " : ""),
      tags.join(" "),
    ]
      .filter(Boolean)
      .join("\n\n");
  let text = build();
  // Passou do limite: tira pontos do fim, alternando entre as duas versões
  while (text.length > CAPTION_LIMIT && (enPts.length > 1 || ptPts.length > 1)) {
    if (ptPts.length >= enPts.length && ptPts.length > 1) ptPts = ptPts.slice(0, -1);
    else enPts = enPts.slice(0, -1);
    text = build();
  }
  return text.slice(0, CAPTION_LIMIT);
}
