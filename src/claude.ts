import Anthropic from "@anthropic-ai/sdk";
import type { Perfil } from "./perfil";
import { buildCaption, type PostParts, type PostTextParts } from "./caption";
import { IMAGE_POST_SCHEMA, imagePostSystemPrompt, imagePostUserPrompt, normalizeImagePost } from "./imagepost";
import { detectLanguage } from "./language";
import { NotAPostError, type PostContent, type Cost, type Drafter, type Post, type TopicIdea } from "./types";

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

/** Preços do Claude Sonnet 5.5 (US$ por milhão de tokens) e da busca na web (por busca). */
export const PRICE = { input: 2 / 1e6, output: 10 / 1e6, search: 10 / 1000 };

export function costOf(usage: { input: number; output: number; searches: number }): Cost {
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

/**
 * Array JSON da resposta (a resposta com busca vem em texto livre): tenta primeiro um bloco
 * ```json```, depois cada "[" do texto até achar um array que feche e seja JSON válido.
 */
export function parseJsonArray<T>(text: string): T[] {
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const candidate of [...fenced, text]) {
    for (let start = candidate.indexOf("["); start >= 0; start = candidate.indexOf("[", start + 1)) {
      let depth = 0;
      let inString = false;
      for (let i = start; i < candidate.length; i++) {
        const ch = candidate[i];
        if (inString) {
          if (ch === "\\") i++;
          else if (ch === '"') inString = false;
        } else if (ch === '"') inString = true;
        else if (ch === "[") depth++;
        else if (ch === "]" && --depth === 0) {
          try {
            const data = JSON.parse(candidate.slice(start, i + 1));
            if (Array.isArray(data) && data.length && typeof data[0] === "object") return data as T[];
          } catch {
            /* não era o array certo: tenta o próximo "[" */
          }
          break;
        }
      }
    }
  }
  return [];
}

// ---------- /temas: assuntos em alta ----------

export function topicsPrompt(today: Date): string {
  const date = today.toISOString().slice(0, 10);
  return `Today is ${date}. Find what software engineers are actively discussing right now (last ~4 weeks) in three areas: software engineering, frontend, and AI engineering (LLM apps, agents, evals, AI-assisted coding).

Search recent news, release notes, surveys, engineering blogs and widely shared discussions (e.g. Hacker News, dev.to, The Pragmatic Engineer, InfoQ, official framework/tool blogs, LinkedIn News pages that are public).

Run several different searches (at least one per area) so you have enough recent material. Suggest 8 topics for a web developer's single-image LinkedIn posts (an infographic: a numbered step-by-step or a don't vs do comparison), mixing the three areas (2 to 3 per area). Prefer topics that turn into practical steps or a clear right vs wrong: a recent release or change people must adapt to, a common mistake, a best practice people get wrong. Avoid generic evergreen advice.

For each topic give:
- "titulo": a post topic in English, specific (max 10 words)
- "area": "software" | "frontend" | "ai"
- "gancho": the hook in English: the claim or question that opens the post (max 20 words)
- "porque": in Brazilian Portuguese, one sentence on why it is engaging now (about the topic itself; no comments about your search or verification)
- "fonte": the publication or site that shows it is current
- "url": copied exactly from a search result you got in this conversation

Only suggest topics backed by something you found in these searches. Reply at the end with ONLY a JSON array, no text before or after.`;
}

/**
 * Temas sem repetidos, no máximo 8, os de site conferido primeiro.
 * Conferido = o site do link apareceu nos resultados da busca. Se houver menos
 * de 4 conferidos, completa com os outros, marcados como não conferidos.
 */
export function verifyTopics(items: TopicIdea[], seen: Set<string>): TopicIdea[] {
  const hosts = new Set([...seen].map((k) => k.split("/")[0]));
  const valid: TopicIdea[] = [];
  for (const it of items) {
    if (!it?.titulo?.trim() || valid.some((o) => o.titulo === it.titulo.trim())) continue;
    const key = it.url ? urlKey(it.url) : null;
    const conferido = Boolean(key && (seen.has(key) || hosts.has(key.split("/")[0])));
    const area = it.area === "frontend" || it.area === "ai" ? it.area : "software";
    valid.push({ titulo: it.titulo.trim(), area, gancho: (it.gancho ?? "").trim(), porque: (it.porque ?? "").trim(), fonte: (it.fonte ?? "").trim(), url: it.url ?? "", conferido });
  }
  const ok = valid.filter((t) => t.conferido);
  const rest = ok.length >= 4 ? [] : valid.filter((t) => !t.conferido);
  return [...ok, ...rest].slice(0, 8);
}

/** Para que foi cada chamada ao Claude (o /custos agrupa por isto). */
export type CostKind = "comentario" | "cena" | "post" | "temas";

/** Recebe o custo de cada chamada assim que ela termina (o bot grava no banco). */
export type CostMeter = (kind: CostKind, cost: Cost) => Promise<void>;

export function usageCost(u: Anthropic.Beta.BetaUsage): Cost {
  return costOf({
    input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens,
    searches: u.server_tool_use?.web_search_requests ?? 0,
  });
}

export class ClaudeDrafter implements Drafter {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private perfil: Perfil,
    private meter?: CostMeter,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  /** Toda chamada passa por aqui: o custo é anotado logo, mesmo que algo falhe depois. */
  private async create(kind: CostKind, params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage> {
    const response = await this.client.beta.messages.create(params);
    await this.meter?.(kind, usageCost(response.usage)).catch((err) => console.error("custo não registrado", err));
    return response;
  }

  async draftComment(post: Pick<Post, "url" | "author" | "text">, avoid: string[]): Promise<string> {
    const response = await this.create("comentario", {
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
  async sceneToPrompt(scene: string): Promise<string> {
    const response = await this.create("cena", {
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system:
        "You turn a scene idea (any language) into one or two English sentences describing only what is visible in an illustration: people, objects, setting, mood. Never ask for text, words, letters, charts or logos in the image. Reply with the description only.",
      messages: [{ role: "user", content: `<scene>\n${scene}\n</scene>` }],
    });
    if (response.stop_reason === "refusal") throw new Error("O Claude não quis descrever essa cena.");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!text) throw new Error("Resposta vazia do Claude.");
    return text;
  }

  /** Conversa com busca na web até a resposta final (a busca pode pausar no meio: pause_turn). */
  private async searchAndAnswer(kind: CostKind, prompt: string, maxUses: number, what: string) {
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
    const content: unknown[] = [];
    let input = 0;
    let output = 0;
    let searches = 0;
    for (let turn = 0; turn < 6; turn++) {
      const response = await this.create(kind, {
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

  async suggestTopics(): Promise<{ items: TopicIdea[]; custo: Cost; sugeridos: number; links: number }> {
    const r = await this.searchAndAnswer("temas", topicsPrompt(new Date()), 6, "A busca de temas");
    const parsed = parseJsonArray<TopicIdea>(r.text);
    const items = verifyTopics(parsed, r.seen);
    console.log("temas", { sugeridos: parsed.length, links: r.seen.size, buscas: r.searches, mantidos: items.length, inicio: r.text.slice(0, 120) });
    return { items, custo: costOf(r), sugeridos: parsed.length, links: r.seen.size };
  }


  /** Post de imagem única: sem pesquisa (não cita números); o Claude escolhe passo a passo ou errado × certo. */
  async draftImagePost(topic: string, previous?: PostContent, instructions?: string): Promise<PostContent> {
    const response = await this.create("post", {
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: IMAGE_POST_SCHEMA } },
      system: imagePostSystemPrompt(this.perfil),
      messages: [{ role: "user", content: imagePostUserPrompt(topic, previous, instructions) }],
    });
    if (response.stop_reason === "refusal") throw new Error("O Claude não quis escrever sobre esse tema.");
    if (response.stop_reason === "max_tokens") throw new Error("O post ficou longo demais. Tente um tema mais específico.");
    const json = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const d = JSON.parse(json) as {
      layout: string;
      titulo: string;
      subtitulo: string;
      passos: { titulo: string; texto: string }[];
      ruim: { titulo: string; itens: string[] };
      bom: { titulo: string; itens: string[] };
      imagem_prompt: string;
      post: PostParts;
      post_pt: PostTextParts;
    };
    if (!d.titulo?.trim()) throw new Error("O post veio sem título. Tente de novo.");
    return {
      titulo: d.titulo.trim(),
      subtitulo: (d.subtitulo ?? "").trim(),
      ...(d.imagem_prompt?.trim() ? { imagem_prompt: d.imagem_prompt.trim() } : {}),
      imagem: normalizeImagePost(d),
      legenda: buildCaption(d.post, d.post_pt),
      custo: costOf({
        input: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0),
        output: response.usage.output_tokens,
        searches: 0,
      }),
    };
  }
}
