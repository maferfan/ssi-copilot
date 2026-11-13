import type { Perfil } from "./perfil";
import type { VideoBeat, VideoFact, VideoScript } from "./types";

/** Fala corrida em português: ~2,7 palavras por segundo. 1 minuto ≈ 160 palavras. */
export const WORDS_PER_SECOND = 2.7;
export const TARGET_WORDS = { min: 140, max: 180 };

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? []).length;
}

/** Texto inteiro que você lê na gravação, na ordem. */
export function spokenText(s: Pick<VideoScript, "abertura" | "trechos" | "fechamento">): string {
  return [s.abertura, ...s.trechos.map((t) => t.fala), s.fechamento].filter(Boolean).join(" ");
}

// ---------- passo 1: fatos com fonte ----------

export function factsPrompt(topic: string): string {
  return `Topic for a 1-minute short video (Instagram Reels/TikTok) in Brazilian Portuguese about human behavior and psychology, explained through video games (and, when it fits, films or books): ${topic}

Search the web and collect 2 to 5 facts the script can rely on: the psychological concept, the study or experiment behind it (who, when, what they found), and, if relevant, a well-known game mechanic or game that shows it. Prefer primary or reputable sources (papers, university pages, APA, Britannica, Simply Psychology, Verywell Mind, well-known game design talks or articles).

Rules:
- Each fact must be backed by a page you found in these searches; "url" copied exactly from a search result.
- Write "fato" in Brazilian Portuguese, one sentence, precise (names, years and numbers only if the source states them).

Reply at the end with ONLY a JSON array, no text before or after:
[{"id": "F1", "fato": "...", "fonte": "site or publication", "ano": "1927", "url": "https://..."}]`;
}

/** Só fatos cujo site apareceu nos resultados da busca. */
export function verifyFacts(items: VideoFact[], seen: Set<string>, key: (url: string) => string | null): VideoFact[] {
  const hosts = new Set([...seen].map((k) => k.split("/")[0]));
  const out: VideoFact[] = [];
  for (const f of items) {
    const k = f?.url ? key(f.url) : null;
    if (!k || !(seen.has(k) || hosts.has(k.split("/")[0])) || !f.fato?.trim()) continue;
    out.push({ id: f.id || `F${out.length + 1}`, fato: f.fato.trim(), fonte: (f.fonte ?? "").trim(), ano: String(f.ano ?? "").trim(), url: f.url });
  }
  return out.slice(0, 5);
}

// ---------- passo 2: o roteiro ----------

export function videoSystemPrompt(p: Perfil): string {
  return `You write 1-minute short-video scripts in Brazilian Portuguese for ${p.nome}'s Instagram/TikTok: human behavior and psychology explained through video games (and sometimes films or books).

Format of the video:
- Opening (~3 s): ${p.nome} appears on camera, sitting, saying one short sentence ("abertura") while a short title ("titulo", max 8 words) is shown big in the middle of the screen. The title is the hook: a question or a claim that makes people stay.
- Then 6 to 8 beats ("trechos"). In each one only his voice continues, and an illustration fills the top of the screen showing EXACTLY what that sentence says.
- A closing line ("fechamento") with the lesson, said over the last image.

Script structure (follow it):
1. Hook with a concrete scene or situation from games or daily life.
2. Name the effect or concept.
3. The proof: the study or experiment (only from the facts given), saying who and what they found.
4. Bring it to games: the mechanic or situation where players feel it.
5. The twist: how the same thing happens in real life.
6. The lesson, short and memorable.

Rules:
- Total spoken text (abertura + all "fala" + fechamento): 150 to 170 words, so it lasts about 1 minute.
- Conversational Portuguese, short sentences, the way a person talks, not like an article. Second person ("você").
- Only state facts, names, years and numbers that are in the facts list. When a beat uses one, set "fato_id".
- He is not a psychologist: present it as an explanation and a reflection, never as diagnosis or treatment advice.
- "imagem": in English, one or two sentences describing a single illustration that shows exactly what the "fala" says (people, objects, setting, action). Never ask for text, letters, numbers, logos, real people's faces or copyrighted game characters; describe a generic scene instead (e.g. "a player holding a controller in front of a glowing screen at night").
- "destaque": 1 to 3 words from that beat to show big in yellow (the key concept or number), or "" when none.
- "legenda": the post text in Portuguese: a hook line, 2 or 3 short lines of context, a question for comments and 3 to 5 hashtags.`;
}

const BEAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fala", "imagem", "destaque", "fato_id"],
  properties: {
    fala: { type: "string" },
    imagem: { type: "string", description: "English illustration description, no text in the image" },
    destaque: { type: "string" },
    fato_id: { type: "string", description: "Fact id used in this beat, or empty" },
  },
} as const;

export const VIDEO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "abertura", "trechos", "fechamento", "legenda"],
  properties: {
    titulo: { type: "string", description: "Hook shown in the middle of the screen, max 8 words" },
    abertura: { type: "string", description: "First sentence, said on camera" },
    trechos: { type: "array", description: "6 to 8 beats", items: BEAT_SCHEMA },
    fechamento: { type: "string" },
    legenda: { type: "string" },
  },
} as const;

export function videoUserPrompt(topic: string, facts: VideoFact[], previous?: VideoScript, instructions?: string): string {
  const f = facts.length
    ? `Facts you may use (verified sources):\n${JSON.stringify(facts.map(({ id, fato, fonte, ano }) => ({ id, fato, fonte, ano })), null, 2)}`
    : "No verified facts were found: do not cite any study, name, year or number; explain the idea in general terms.";
  const prev = previous ? `\n\nCurrent version:\n${JSON.stringify({ titulo: previous.titulo, abertura: previous.abertura, trechos: previous.trechos, fechamento: previous.fechamento, legenda: previous.legenda }, null, 2)}` : "";
  const ask = instructions
    ? `\n\nChange requested by the author (keep everything else):\n<ajuste>\n${instructions}\n</ajuste>`
    : previous
      ? "\n\nThe author wants a completely different version (new hook, new angle)."
      : "";
  return `Topic: ${topic}\n\n${f}${prev}${ask}\n\nWrite the script.`;
}

type DraftScript = Pick<VideoScript, "titulo" | "abertura" | "fechamento" | "legenda"> & { trechos: VideoBeat[] };

/** Limpa o que veio do modelo, liga os fatos citados e calcula palavras e duração. */
export function finalizeScript(d: DraftScript, facts: VideoFact[]): VideoScript {
  const ids = new Set(facts.map((f) => f.id));
  const trechos = (d.trechos ?? [])
    .filter((t) => t?.fala?.trim())
    .slice(0, 9)
    .map((t) => ({
      fala: t.fala.trim(),
      imagem: (t.imagem ?? "").trim(),
      destaque: (t.destaque ?? "").trim().split(/\s+/).slice(0, 3).join(" "),
      fato_id: ids.has(t.fato_id) ? t.fato_id : "",
    }));
  if (!d.titulo?.trim() || trechos.length < 3) throw new Error("O roteiro veio incompleto. Tente de novo.");
  const base = { titulo: d.titulo.trim(), abertura: (d.abertura ?? "").trim(), trechos, fechamento: (d.fechamento ?? "").trim() };
  const palavras = countWords(spokenText(base));
  const used = new Set(trechos.map((t) => t.fato_id).filter(Boolean));
  return {
    ...base,
    legenda: (d.legenda ?? "").trim(),
    fatos: facts.filter((f) => used.has(f.id)),
    palavras,
    segundos: Math.round(palavras / WORDS_PER_SECOND),
  };
}
