const PT_WORDS = new Set("de que não nao para com uma um os as é você voce mais por como isso mas se na no do da em ao seu sua são sao também tambem muito quando já ja eu nós nos ele ela foi ser ter".split(" "));
const EN_WORDS = new Set("the and to of is you that for with it this are on your in be not have i we was what how can will my our they at from an or about just more if".split(" "));

/** Idioma do post pela contagem de palavras comuns e acentos. Sem texto, assume português. */
export function detectLanguage(text: string | null): "pt" | "en" {
  if (!text) return "pt";
  const words = text.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [];
  let pt = (text.match(/[ãõçáéíóúâêôà]/gi) ?? []).length * 0.5;
  let en = 0;
  for (const w of words) {
    if (PT_WORDS.has(w)) pt++;
    if (EN_WORDS.has(w)) en++;
  }
  return en > pt ? "en" : "pt";
}
