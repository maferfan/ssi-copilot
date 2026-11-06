import Anthropic from "@anthropic-ai/sdk";
import type { Perfil } from "./perfil";
import { normalizeCarousel } from "./carousel";
import type { CarouselContent, Drafter, Post } from "./types";

export const MODEL = "claude-sonnet-5-5";

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
${p.regras.map((r) => `- ${r}`).join("\n")}${exemplos}

${p.nome} sempre revisa o rascunho antes de publicar. Responda somente com o texto do comentário, sem aspas e sem explicações.`;
}

export function userPrompt(post: Pick<Post, "url" | "author" | "text">, avoid: string[]): string {
  const outras = avoid.length
    ? `\n\nJá foram sugeridas estas versões e o usuário pediu outra. Traga um ângulo diferente:\n${avoid.map((a) => `- ${a}`).join("\n")}`
    : "";
  return `Post de ${post.author ?? "autor desconhecido"} (${post.url}):

<post>
${post.text ?? ""}
</post>

Escreva um comentário para este post.${outras}`;
}

export function carouselSystemPrompt(p: Perfil): string {
  return `Você escreve carrosséis (posts em slides) para o LinkedIn de ${p.nome}.

Sobre ${p.nome}: ${p.resumo}
Objetivo: ${p.objetivo}

Como um bom carrossel funciona:
- A capa promete um ganho concreto para quem ler. Título curto (até 8 palavras), subtítulo de uma linha.
- De 5 a 8 slides no meio, um por ideia. Título de até 7 palavras, texto de até 40 palavras.
- Conteúdo prático e específico: exemplos, passos, erros comuns, números só quando forem conhecidos de verdade.
- O último slide fecha com uma conclusão e convida a comentar ou seguir.
- Destaque no máximo um trecho por slide com **asteriscos duplos**.
- A legenda do post tem de 3 a 6 linhas: um gancho na primeira linha, o porquê do tema, uma pergunta no fim e até 3 hashtags.
- Escreva em português do Brasil, no tom de ${p.nome}: ${p.tom.join(" ")}`;
}

const CAROUSEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "subtitulo", "slides", "fechamento", "legenda"],
  properties: {
    titulo: { type: "string", description: "Título da capa" },
    subtitulo: { type: "string", description: "Uma linha abaixo do título da capa" },
    slides: {
      type: "array",
      description: "De 5 a 8 slides de conteúdo",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["titulo", "texto"],
        properties: { titulo: { type: "string" }, texto: { type: "string" } },
      },
    },
    fechamento: {
      type: "object",
      additionalProperties: false,
      required: ["titulo", "texto"],
      properties: { titulo: { type: "string" }, texto: { type: "string" } },
    },
    legenda: { type: "string", description: "Texto do post que acompanha o carrossel" },
  },
} as const;

export function carouselUserPrompt(topic: string, previous?: CarouselContent, instructions?: string): string {
  if (previous && instructions) {
    return `Tema: ${topic}

Versão atual do carrossel:
${JSON.stringify(previous, null, 2)}

Ajuste pedido pelo autor:
<ajuste>
${instructions}
</ajuste>

Devolva o carrossel completo com o ajuste aplicado, mantendo o que não foi pedido para mudar.`;
  }
  if (previous) {
    return `Tema: ${topic}

Já existe esta versão, mas o autor pediu outra completamente diferente (outro ângulo, outros exemplos):
${JSON.stringify(previous, null, 2)}`;
  }
  return `Tema: ${topic}

Escreva o carrossel.`;
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
    return text.replace(/^["“]|["”]$/g, "").trim();
  }

  async draftCarousel(topic: string, previous?: CarouselContent, instructions?: string): Promise<CarouselContent> {
    const response = await this.client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: CAROUSEL_SCHEMA } },
      system: carouselSystemPrompt(this.perfil),
      messages: [{ role: "user", content: carouselUserPrompt(topic, previous, instructions) }],
    });

    if (response.stop_reason === "refusal") throw new Error("O Claude não quis escrever sobre esse tema.");
    if (response.stop_reason === "max_tokens") throw new Error("O carrossel ficou longo demais. Tente um tema mais específico.");
    const json = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return normalizeCarousel(JSON.parse(json) as CarouselContent);
  }
}
