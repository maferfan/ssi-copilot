import Anthropic from "@anthropic-ai/sdk";
import type { Perfil } from "./perfil";
import { normalizeCarousel } from "./carousel";
import { detectLanguage } from "./language";
import { NotAPostError, type CarouselChart, type CarouselContent, type CarouselCost, type Drafter, type Post, type TopicIdea } from "./types";

export const MODEL = "claude-sonnet-5-5";

/** Resposta combinada para quando o texto não é um post (o bot pede o texto certo em vez de mostrar sugestão). */
export const NOT_A_POST = "SEM_POST";

export function systemPrompt(p: Perfil): string {
  const exemplos = p.exemplos.length
    ? `\n\nComentários que ${p.nome} já escreveu (imite o tom, não o conteúdo):\n${p.exemplos.map((e) => `- ${e}`).join("\n")}`
    : "";
  return `Você escreve rascunhos de comentários para o LinkedIn de ${p.nome}.

Sobre ${p.nome}: ${p.resumo}
Objetivo: ${p.objetivo}

Tom:
${p.tom.map((t) => `- ${t}`).join("\n")}

Regras:
${p.regras.map((r) => `- ${r}`).join("\n")}
- Se o conteúdo dentro de <post> não for um post de verdade (texto de página de login ou cadastro do LinkedIn, texto genérico, vazio ou sem assunto), responda exatamente: ${NOT_A_POST}${exemplos}

${p.nome} sempre revisa o rascunho antes de publicar. Responda somente com o texto do comentário, sem aspas e sem explicações.`;
}

export function userPrompt(post: Pick<Post, "url" | "author" | "text">, avoid: string[]): string {
  const outras = avoid.length
    ? `\n\nJá foram sugeridas estas versões e o usuário pediu outra. Traga um ângulo diferente:\n${avoid.map((a) => `- ${a}`).join("\n")}`
    : "";
  const idioma =
    detectLanguage(post.text) === "en"
      ? "O post está em inglês: escreva o comentário em inglês natural, como um profissional de tecnologia escreveria."
      : "O post está em português: escreva o comentário em português do Brasil.";
  return `Post de ${post.author ?? "autor desconhecido"} (${post.url}):

<post>
${post.text ?? ""}
</post>

Escreva um comentário para este post. ${idioma}${outras}`;
}

// ---------- carrossel: pesquisa com fontes + escrita em inglês ----------

/** Dado encontrado na pesquisa. Os números do gráfico vêm daqui, nunca do texto escrito depois. */
export interface ResearchItem {
  id: string;
  fonte: string;
  ano: string;
  url: string;
  achado: string;
  tipo: "bar" | "line";
  unidade: string;
  dados: { label: string; valor: number }[];
}

/** Preços do Claude Sonnet 5.5 (US$ por milhão de tokens) e da busca na web (por busca). */
export const PRICE = { input: 2 / 1e6, output: 10 / 1e6, search: 10 / 1000 };

export function costOf(usage: { input: number; output: number; searches: number }): CarouselCost {
  const usd = usage.input * PRICE.input + usage.output * PRICE.output + usage.searches * PRICE.search;
  return { inputTokens: usage.input, outputTokens: usage.output, searches: usage.searches, usd: Math.round(usd * 1000) / 1000 };
}

/** "https://www.Site.com/a/b/?utm=x#y" → "site.com/a/b" (para comparar links). */
export function urlKey(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Links que vieram dos resultados da busca (e das citações), nunca do texto livre do modelo. */
export function searchedUrls(content: unknown[]): Set<string> {
  const urls = new Set<string>();
  const grab = (v: unknown) => {
    for (const m of JSON.stringify(v ?? null).matchAll(/https?:\/\/[^\s"'<>\\]+/g)) {
      const k = urlKey(m[0]);
      if (k) urls.add(k);
    }
  };
  for (const block of content as { type?: string; citations?: unknown }[]) {
    if (block?.type === "text") grab(block.citations);
    else grab(block);
  }
  return urls;
}

/** Fica só com dados cujo link apareceu na busca e que dão um gráfico (2 a 8 números). */
export function verifyResearch(items: ResearchItem[], seen: Set<string>): ResearchItem[] {
  return items.filter((it) => {
    const key = it?.url ? urlKey(it.url) : null;
    const dados = Array.isArray(it?.dados) ? it.dados.filter((d) => Number.isFinite(Number(d?.valor)) && String(d?.label ?? "").trim()) : [];
    return Boolean(key && seen.has(key) && it.fonte?.trim() && dados.length >= 2 && dados.length <= 8);
  });
}

/** Primeiro array JSON do texto (a resposta com busca vem em texto livre). */
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

export function researchPrompt(topic: string): string {
  return `Topic for a LinkedIn carousel aimed at developers and tech recruiters: ${topic}

Search the web and collect 3 to 6 quantitative data points that support this topic, from reputable primary sources (developer surveys such as Stack Overflow Developer Survey, State of JS/CSS, JetBrains; HTTP Archive Web Almanac; web.dev / Chrome UX Report; GitHub Octoverse; official statistics; peer-reviewed or well-known industry reports). Prefer data from the last 3 years.

Rules:
- Copy the numbers exactly as published. Do not estimate, round differently, combine or invent values.
- Each data point must be chart-ready: 2 to 8 labelled numbers (e.g. percentages per answer, or a value per year).
- "url" must be the page where the number is published.
- Use "line" only for values over time; otherwise "bar".

Reply at the end with ONLY a JSON array, no text before or after:
[{"id": "R1", "fonte": "publisher or report name", "ano": "2025", "url": "https://...", "achado": "one-sentence finding", "tipo": "bar" | "line", "unidade": "%" or "ms" or "" , "dados": [{"label": "...", "valor": 42}]}]`;
}

// ---------- /temas: assuntos em alta ----------

export function topicsPrompt(today: Date): string {
  const date = today.toISOString().slice(0, 10);
  return `Today is ${date}. Find what software engineers are actively discussing right now (last ~4 weeks) in three areas: software engineering, frontend, and AI engineering (LLM apps, agents, evals, AI-assisted coding).

Search recent news, release notes, surveys, engineering blogs and widely shared discussions (e.g. Hacker News, dev.to, The Pragmatic Engineer, InfoQ, official framework/tool blogs, LinkedIn News pages that are public).

Suggest 8 carousel topics for a web developer's LinkedIn, mixing the three areas. Prefer topics that spark discussion: a recent release or change people must react to, a surprising number, a common mistake, a debate with two sides. Avoid generic evergreen advice.

For each topic give:
- "titulo": a carousel topic in English, specific (max 10 words)
- "area": "software" | "frontend" | "ai"
- "gancho": the hook in English: the claim or question that opens the post (max 20 words)
- "porque": in Brazilian Portuguese, one sentence on why it is engaging now
- "fonte": the publication or site that shows it is current
- "url": the page you found it on

Reply at the end with ONLY a JSON array, no text before or after.`;
}

/** Só temas com link conferido na busca, sem repetidos, no máximo 8. */
export function verifyTopics(items: TopicIdea[], seen: Set<string>): TopicIdea[] {
  const out: TopicIdea[] = [];
  for (const it of items) {
    const key = it?.url ? urlKey(it.url) : null;
    if (!key || !seen.has(key) || !it.titulo?.trim() || out.some((o) => o.titulo === it.titulo)) continue;
    const area = it.area === "frontend" || it.area === "ai" ? it.area : "software";
    out.push({ titulo: it.titulo.trim(), area, gancho: (it.gancho ?? "").trim(), porque: (it.porque ?? "").trim(), fonte: (it.fonte ?? "").trim(), url: it.url });
    if (out.length >= 8) break;
  }
  return out;
}

export function carouselSystemPrompt(p: Perfil): string {
  return `You write LinkedIn carousels (slide posts) for ${p.nome}, always in English.

About ${p.nome}: ${p.resumo}
Goal: ${p.objetivo}

What a good carousel looks like:
- Short carousels: 3 to 5 slides in total = cover + 1 to 3 content slides + closing. Prefer 1 content slide (3 slides total); use more only if the topic truly needs it.
- The cover (slide 1) ALWAYS has a chart ("grafico_capa"): the strongest data point, used as the hook. Short title (up to 8 words) that the chart backs up, one-line subtitle.
- Content slides: one idea each. Title up to 7 words. Text up to 40 words, or up to 28 words on a slide with a chart.
- "imagem_prompt": one or two English sentences describing a cover illustration that makes the topic concrete (a scene or a metaphor with people or objects, e.g. "a developer at a desk watching a slow loading bar stretch across a dark room"). Describe only what is seen; never ask for text, words, charts or logos in the image.
- At most 3 charts in total, counting the cover. Content slides without a chart use mode "none" (text only).
  - mode "research": use a research item that fits (by its id). Its numbers are inserted automatically; do not repeat them in "dados". Prefer this whenever a research item fits.
  - mode "illustrative": only if no research item fits any slide, so the carousel still has a chart. Use a conceptual comparison with obviously relative values (e.g. effort vs impact on a 1-10 scale). It is labelled "Illustrative" on the slide. Never present illustrative values as facts in the text.
- Only state numbers in the text that come from a research item you are using on that slide.
- The last slide wraps up and invites people to comment or follow.
- Highlight at most one phrase per slide with **double asterisks**.
- The post caption has 3 to 6 lines: a hook in the first line, why it matters, a question at the end, "Sources are cited under each chart." and up to 3 hashtags.
- Practical, specific, no fluff. Tone: ${p.tom.join(" ")}`;
}

const CHART_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["modo", "id_pesquisa", "tipo", "titulo", "unidade", "dados"],
  properties: {
    modo: { type: "string", enum: ["research", "illustrative", "none"], description: "none = text-only slide" },
    id_pesquisa: { type: "string", description: "Research item id (mode research); empty otherwise" },
    tipo: { type: "string", enum: ["bar", "line"] },
    titulo: { type: "string", description: "Short chart title" },
    unidade: { type: "string", description: "Unit, e.g. % or ms; empty if none" },
    dados: {
      type: "array",
      description: "Only for illustrative charts (2 to 6 points); empty otherwise",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "valor"],
        properties: { label: { type: "string" }, valor: { type: "number" } },
      },
    },
  },
} as const;

const CAROUSEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "subtitulo", "grafico_capa", "imagem_prompt", "slides", "fechamento", "legenda"],
  properties: {
    titulo: { type: "string", description: "Cover title" },
    subtitulo: { type: "string", description: "One line under the cover title" },
    imagem_prompt: { type: "string", description: "Cover illustration description in English, no text in the image" },
    grafico_capa: { ...CHART_SCHEMA, description: "Cover chart (always present: research or illustrative, never none)" },
    slides: {
      type: "array",
      description: "1 to 3 content slides (prefer 1); charts optional, at most 2 here",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titulo", "texto", "grafico"],
        properties: { titulo: { type: "string" }, texto: { type: "string" }, grafico: CHART_SCHEMA },
      },
    },
    fechamento: {
      type: "object",
      additionalProperties: false,
      required: ["titulo", "texto"],
      properties: { titulo: { type: "string" }, texto: { type: "string" } },
    },
    legenda: { type: "string", description: "Post caption" },
  },
} as const;

interface DraftChart {
  modo: "research" | "illustrative" | "none";
  id_pesquisa: string;
  tipo: "bar" | "line";
  titulo: string;
  unidade: string;
  dados: { label: string; valor: number }[];
}

/** Monta o gráfico final: com fonte, os números saem da pesquisa conferida; senão, vira ilustrativo. */
export function buildChart(d: DraftChart | undefined, research: ResearchItem[]): CarouselChart | undefined {
  if (!d || d.modo === "none") return undefined;
  const item = d.modo === "research" ? research.find((r) => r.id === d.id_pesquisa) : undefined;
  if (item) {
    return {
      tipo: item.tipo === "line" ? "line" : "bar",
      titulo: d.titulo || item.achado,
      unidade: item.unidade ?? "",
      dados: item.dados.map((x) => ({ label: String(x.label), valor: Number(x.valor) })),
      fonte: { nome: item.fonte, url: item.url, ano: item.ano ?? "" },
      ilustrativo: false,
    };
  }
  if (!Array.isArray(d.dados) || d.dados.length < 2) return undefined;
  return { tipo: d.tipo, titulo: d.titulo, unidade: d.unidade, dados: d.dados, fonte: null, ilustrativo: true };
}

type ContentSlide = { titulo: string; texto: string; grafico?: CarouselChart };

/**
 * A capa sempre tem gráfico: se o modelo não pôs, sobe o primeiro gráfico dos slides;
 * se nenhum slide tem, usa o primeiro dado conferido da pesquisa.
 */
export function ensureCoverChart(cover: CarouselChart | undefined, slides: ContentSlide[], research: ResearchItem[]) {
  if (cover) return { cover, slides };
  const idx = slides.findIndex((s) => s.grafico);
  if (idx >= 0) {
    const moved = slides[idx].grafico;
    return { cover: moved, slides: slides.map((s, i) => (i === idx ? { titulo: s.titulo, texto: s.texto } : s)) };
  }
  const first = research[0];
  const fromResearch = first ? buildChart({ modo: "research", id_pesquisa: first.id, tipo: first.tipo, titulo: first.achado, unidade: "", dados: [] }, research) : undefined;
  return { cover: fromResearch, slides };
}

/** Pesquisa já conferida de uma versão anterior, para ajustes não pagarem nova busca. */
export function researchFromCarousel(c: CarouselContent): ResearchItem[] {
  return [c.capa_grafico, ...c.slides.map((s) => s.grafico)].flatMap((g, i) =>
    g?.fonte ? [{ id: `R${i + 1}`, fonte: g.fonte.nome, ano: g.fonte.ano, url: g.fonte.url, achado: g.titulo, tipo: g.tipo, unidade: g.unidade, dados: g.dados }] : [],
  );
}

export function carouselUserPrompt(topic: string, research: ResearchItem[], previous?: CarouselContent, instructions?: string): string {
  const data = research.length
    ? `Research items (verified sources):\n${JSON.stringify(research, null, 2)}`
    : "No verified research items were found: use illustrative charts only, and state no numbers as facts.";
  const prev = previous ? `\n\nCurrent version:\n${JSON.stringify({ ...previous, custo: undefined }, null, 2)}` : "";
  const ask = instructions
    ? `\n\nChange requested by the author (keep everything else):\n<ajuste>\n${instructions}\n</ajuste>`
    : previous
      ? "\n\nThe author wants a completely different version (new angle, new examples)."
      : "";
  return `Topic: ${topic}\n\n${data}${prev}${ask}\n\nWrite the carousel in English.`;
}

export class ClaudeDrafter implements Drafter {
  private client: Anthropic;

  constructor(apiKey: string, private perfil: Perfil) {
    this.client = new Anthropic({ apiKey });
  }

  async draftComment(post: Pick<Post, "url" | "author" | "text">, avoid: string[]): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: systemPrompt(this.perfil),
      messages: [{ role: "user", content: userPrompt(post, avoid) }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("O Claude não quis comentar este post.");
    }
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) throw new Error("Resposta vazia do Claude.");
    if (text.includes(NOT_A_POST)) throw new NotAPostError();
    return text.replace(/^["“]|["”]$/g, "").trim();
  }

  /** Passo 1: busca na web e devolve só os dados cujo link apareceu nos resultados. */
  /** Conversa com busca na web até a resposta final (a busca pode pausar no meio: pause_turn). */
  private async searchAndAnswer(prompt: string, maxUses: number, what: string) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
    const content: unknown[] = [];
    let input = 0;
    let output = 0;
    let searches = 0;
    for (let turn = 0; turn < 4; turn++) {
      const response = await this.client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: maxUses }],
        messages,
      });
      input += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0);
      output += response.usage.output_tokens;
      searches += response.usage.server_tool_use?.web_search_requests ?? 0;
      content.push(...response.content);
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      if (response.stop_reason === "refusal") throw new Error(`${what} foi recusada.`);
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { text, seen: searchedUrls(content), input, output, searches };
    }
    throw new Error(`${what} não terminou.`);
  }

  /** Passo 1 do carrossel: dados com fonte, só os que tiveram o link conferido na busca. */
  private async research(topic: string): Promise<{ items: ResearchItem[]; input: number; output: number; searches: number }> {
    const r = await this.searchAndAnswer(researchPrompt(topic), 6, "A pesquisa sobre esse tema");
    return { items: verifyResearch(parseJsonArray<ResearchItem>(r.text), r.seen), input: r.input, output: r.output, searches: r.searches };
  }

  async suggestTopics(): Promise<{ items: TopicIdea[]; custo: CarouselCost }> {
    const r = await this.searchAndAnswer(topicsPrompt(new Date()), 6, "A busca de temas");
    return { items: verifyTopics(parseJsonArray<TopicIdea>(r.text), r.seen), custo: costOf(r) };
  }


  async draftCarousel(topic: string, previous?: CarouselContent, instructions?: string): Promise<CarouselContent> {
    // Ajuste reaproveita as fontes já conferidas; tema novo ou "refazer" pesquisa de novo
    const research = previous && instructions ? { items: researchFromCarousel(previous), input: 0, output: 0, searches: 0 } : await this.research(topic);

    const response = await this.client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: CAROUSEL_SCHEMA } },
      system: carouselSystemPrompt(this.perfil),
      messages: [{ role: "user", content: carouselUserPrompt(topic, research.items, previous, instructions) }],
    });

    if (response.stop_reason === "refusal") throw new Error("O Claude não quis escrever sobre esse tema.");
    if (response.stop_reason === "max_tokens") throw new Error("O carrossel ficou longo demais. Tente um tema mais específico.");
    const json = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const draft = JSON.parse(json) as Omit<CarouselContent, "slides" | "capa_grafico"> & {
      grafico_capa?: DraftChart;
      slides: { titulo: string; texto: string; grafico?: DraftChart }[];
    };
    const custo = costOf({
      input: research.input + response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
      output: research.output + response.usage.output_tokens,
      searches: research.searches,
    });
    const { cover, slides } = ensureCoverChart(
      buildChart(draft.grafico_capa, research.items),
      draft.slides.map((s) => ({ titulo: s.titulo, texto: s.texto, grafico: buildChart(s.grafico, research.items) })),
      research.items,
    );
    const { grafico_capa: _ignored, ...rest } = draft;
    return normalizeCarousel({ ...rest, capa_grafico: cover, slides, custo });
  }

}
