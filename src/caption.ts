/** Partes do texto do post; o código monta sempre no mesmo formato. */
export interface PostParts {
  titulo: string;
  gancho: string;
  pontos: string[];
  conclusao: string;
  pergunta: string;
  hashtags: string[];
}

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

/**
 * Título em negrito, gancho (o que aparece antes do "…ver mais"), pontos em lista,
 * conclusão, pergunta para puxar comentários, aviso das fontes e hashtags.
 */
export function buildCaption(p: PostParts): string {
  const tags = (p.hashtags ?? [])
    .map((t) => clean(t).replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => `#${t}`);
  let pontos = (p.pontos ?? []).map(clean).filter(Boolean).slice(0, 5);
  const build = () =>
    [
      boldUnicode(clean(p.titulo)),
      clean(p.gancho),
      pontos.map((x) => `→ ${x}`).join("\n"),
      clean(p.conclusao),
      p.pergunta ? `👉 ${clean(p.pergunta)}` : "",
      "📊 Sources are cited under each chart.",
      tags.join(" "),
    ]
      .filter(Boolean)
      .join("\n\n");
  let text = build();
  while (text.length > CAPTION_LIMIT && pontos.length > 1) {
    pontos = pontos.slice(0, -1);
    text = build();
  }
  return text.slice(0, CAPTION_LIMIT);
}
