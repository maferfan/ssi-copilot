import Anthropic from "@anthropic-ai/sdk";
import type { Perfil } from "./perfil";
import type { Drafter, Post } from "./types";

export const MODEL = "claude-opus-5-5";

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
}
