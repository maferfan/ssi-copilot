import { extractLinkedInUrl, textAroundUrl } from "./linkedin";
import type { Perfil } from "./perfil";
import type { TgUpdate } from "./telegram";
import type { Awaiting, Deps, InlineButton, Post } from "./types";

/** Quantos posts no máximo viram sugestão a cada rodada das 18h. */
export const DAILY_LIMIT = 5;

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function excerpt(text: string | null, max = 280): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const HELP = `<b>Como funciona</b>

1. Viu um post bom no LinkedIn? Toque em <b>Compartilhar → Enviar</b> e mande o link pra cá (ou cole o texto do post junto com o link).
2. Todo dia às <b>18h</b> eu mando uma sugestão de comentário para cada post salvo.
3. Você aprova, pede outra versão, edita ou pula.
4. Depois de colar no LinkedIn, toque em <b>✔️ Já comentei</b> para contar no seu resumo.

/agora — gerar as sugestões agora
/fila — ver os posts salvos
/semana — resumo dos últimos 7 dias`;

export function draftCard(post: Post, index?: { i: number; total: number }): string {
  const head = index ? `📝 <b>Post ${index.i}/${index.total}</b>` : "📝 <b>Post</b>";
  return `${head} · ${esc(post.author ?? "autor desconhecido")}
<i>${esc(excerpt(post.text))}</i>
🔗 ${esc(post.url)}

💬 <b>Sugestão:</b>
${esc(post.draft ?? "")}`;
}

export function draftButtons(id: number): InlineButton[][] {
  return [
    [
      { text: "✅ Aprovar", data: `a:${id}` },
      { text: "🔄 Outra versão", data: `r:${id}` },
    ],
    [
      { text: "✏️ Editar", data: `e:${id}` },
      { text: "❌ Pular", data: `s:${id}` },
    ],
  ];
}

export function approvedCard(post: Post): string {
  return `✅ <b>Comentário pronto</b> · ${esc(post.author ?? "post")}
Toque no texto para copiar, abra o link e cole:

<code>${esc(post.final_comment ?? "")}</code>

🔗 ${esc(post.url)}`;
}

export class Bot {
  constructor(private deps: Deps, private perfil: Perfil) {}

  private iso() {
    return this.deps.now().toISOString();
  }

  /** Chat do dono: vem da configuração ou do primeiro /start. */
  async ownerChat(): Promise<number | null> {
    if (this.deps.ownerChatId) return this.deps.ownerChatId;
    const saved = await this.deps.store.getSetting("owner_chat_id");
    return saved ? Number(saved) : null;
  }

  private async getAwaiting(): Promise<Awaiting | null> {
    const raw = await this.deps.store.getSetting("awaiting");
    return raw ? (JSON.parse(raw) as Awaiting) : null;
  }

  private async setAwaiting(a: Awaiting | null) {
    await this.deps.store.setSetting("awaiting", a ? JSON.stringify(a) : null);
  }

  async handleUpdate(update: TgUpdate): Promise<void> {
    if (update.message) return this.onMessage(update.message);
    if (update.callback_query) return this.onCallback(update.callback_query);
  }

  // ---------- mensagens ----------

  private async onMessage(msg: NonNullable<TgUpdate["message"]>) {
    const chatId = msg.chat.id;
    const text = (msg.text ?? msg.caption ?? "").trim();
    const { messenger, store } = this.deps;

    let owner = await this.ownerChat();
    if (owner === null && text.startsWith("/start")) {
      await store.setSetting("owner_chat_id", String(chatId));
      owner = chatId;
    }
    if (owner !== chatId) {
      await messenger.send(chatId, "Este é um bot pessoal. 🙂");
      return;
    }

    const command = text.match(/^\/(\w+)/)?.[1]?.toLowerCase();
    if (command) {
      await this.setAwaiting(null);
      switch (command) {
        case "start":
          await messenger.send(chatId, `Olá! Eu sou o seu SSI Copilot. 👋\n\n${HELP}`);
          return;
        case "agora":
          await this.runDaily();
          return;
        case "fila":
          await this.sendQueue(chatId);
          return;
        case "semana":
          await this.sendWeek(chatId);
          return;
        default:
          await messenger.send(chatId, HELP);
          return;
      }
    }

    const entityUrls = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])].flatMap((e) => (e.url ? [e.url] : []));
    const url = extractLinkedInUrl(text, entityUrls);
    if (url) {
      await this.setAwaiting(null);
      await this.savePost(chatId, url, textAroundUrl(text, url));
      return;
    }

    const awaiting = await this.getAwaiting();
    if (awaiting && text) {
      await this.setAwaiting(null);
      if (awaiting.type === "post_text") {
        await store.updatePost(awaiting.postId, { text, status: "pending" });
        await messenger.send(chatId, `Texto salvo ✔ ${await this.queueLine()}`);
      } else {
        await store.updatePost(awaiting.postId, { final_comment: text, status: "approved" });
        const post = await store.getPost(awaiting.postId);
        if (post) await messenger.send(chatId, approvedCard(post), [[{ text: "✔️ Já comentei", data: `d:${post.id}` }]]);
      }
      return;
    }

    await messenger.send(chatId, `Não encontrei um link do LinkedIn nessa mensagem.\n\n${HELP}`);
  }

  private async queueLine() {
    const n = (await this.deps.store.listPosts(["pending"], 100)).length;
    return n === 1 ? "1 post na fila para as 18h." : `${n} posts na fila para as 18h.`;
  }

  private async savePost(chatId: number, url: string, pastedText: string) {
    const { store, messenger, fetchPreview } = this.deps;

    // Texto colado junto com o link vale mais que a prévia (é o post inteiro)
    if (pastedText.length >= 40) {
      const preview = await fetchPreview(url);
      await store.addPost({ url, author: preview?.author ?? null, text: pastedText, status: "pending", createdAt: this.iso() });
      await messenger.send(chatId, `Post salvo ✔ ${await this.queueLine()}`);
      return;
    }

    const preview = await fetchPreview(url);
    if (preview?.text) {
      await store.addPost({ url, author: preview.author, text: preview.text, status: "pending", createdAt: this.iso() });
      const who = preview.author ? ` de ${esc(preview.author)}` : "";
      await messenger.send(chatId, `Post${who} salvo ✔ ${await this.queueLine()}`);
      return;
    }

    const id = await store.addPost({ url, author: null, text: null, status: "needs_text", createdAt: this.iso() });
    await this.setAwaiting({ type: "post_text", postId: id });
    await messenger.send(
      chatId,
      "Salvei o link, mas o LinkedIn não me deixou ler o texto. 😕\nCopie o texto do post e cole aqui na próxima mensagem.",
    );
  }

  private async sendQueue(chatId: number) {
    const posts = await this.deps.store.listPosts(["needs_text", "pending", "drafted", "approved"], 30);
    if (posts.length === 0) {
      await this.deps.messenger.send(chatId, "A fila está vazia. Mande um link de post do LinkedIn para salvar.");
      return;
    }
    const label: Record<string, string> = {
      needs_text: "falta o texto",
      pending: "aguardando 18h",
      drafted: "sugestão enviada",
      approved: "aprovado, falta colar",
    };
    const lines = posts.map((p) => `• ${esc(p.author ?? "post")} — <i>${label[p.status]}</i>\n  ${esc(excerpt(p.text, 80) || p.url)}`);
    await this.deps.messenger.send(chatId, `<b>Fila (${posts.length})</b>\n\n${lines.join("\n")}`);
  }

  private async sendWeek(chatId: number) {
    const since = new Date(this.deps.now().getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const c = await this.deps.store.countActionsSince(since);
    await this.deps.messenger.send(
      chatId,
      `<b>Últimos 7 dias</b>\n\n💬 Comentários: ${c.comment ?? 0}\n📊 Posts: ${c.post ?? 0}\n🤝 Convites: ${c.invite ?? 0}`,
    );
  }

  // ---------- botões ----------

  private async onCallback(cb: NonNullable<TgUpdate["callback_query"]>) {
    const { messenger, store, drafter } = this.deps;
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    const [action, rawId] = (cb.data ?? "").split(":");
    const id = Number(rawId);

    if (!chatId || !messageId || chatId !== (await this.ownerChat())) {
      await messenger.answerCallback(cb.id);
      return;
    }
    const post = await store.getPost(id);
    if (!post) {
      await messenger.answerCallback(cb.id, "Post não encontrado.");
      return;
    }

    switch (action) {
      case "a": {
        await messenger.answerCallback(cb.id, "Aprovado!");
        await store.updatePost(id, { status: "approved", final_comment: post.draft });
        const updated = { ...post, status: "approved" as const, final_comment: post.draft };
        await messenger.edit(chatId, messageId, `${draftCard(post)}\n\n✅ <i>Aprovado</i>`);
        await messenger.send(chatId, approvedCard(updated), [[{ text: "✔️ Já comentei", data: `d:${id}` }]]);
        return;
      }
      case "r": {
        await messenger.answerCallback(cb.id, "Escrevendo outra versão…");
        try {
          const draft = await drafter.draftComment(post, post.draft ? [post.draft] : []);
          await store.updatePost(id, { draft, status: "drafted" });
          await messenger.edit(chatId, messageId, draftCard({ ...post, draft }), draftButtons(id));
        } catch (err) {
          await messenger.send(chatId, `Não consegui gerar outra versão agora: ${esc(String((err as Error).message))}`);
        }
        return;
      }
      case "e": {
        await messenger.answerCallback(cb.id);
        await this.setAwaiting({ type: "edit", postId: id });
        await messenger.send(chatId, "Mande a sua versão do comentário na próxima mensagem. ✏️");
        return;
      }
      case "s": {
        await messenger.answerCallback(cb.id, "Pulado");
        await store.updatePost(id, { status: "skipped" });
        await messenger.edit(chatId, messageId, `${draftCard(post)}\n\n❌ <i>Pulado</i>`);
        return;
      }
      case "d": {
        if (post.status === "commented") {
          await messenger.answerCallback(cb.id, "Já estava registrado.");
          return;
        }
        await messenger.answerCallback(cb.id, "Registrado! 💪");
        await store.updatePost(id, { status: "commented" });
        await store.logAction("comment", id, this.iso());
        await messenger.edit(chatId, messageId, `${approvedCard(post)}\n\n✔️ <i>Comentado</i>`);
        return;
      }
      default:
        await messenger.answerCallback(cb.id);
    }
  }

  // ---------- rodada das 18h ----------

  async runDaily(): Promise<void> {
    const { store, messenger, drafter } = this.deps;
    const chatId = await this.ownerChat();
    if (chatId === null) return; // ninguém deu /start ainda

    const posts = await store.listPosts(["pending"], DAILY_LIMIT);
    if (posts.length === 0) {
      await messenger.send(chatId, this.emptyDayMessage(await store.listPosts(["needs_text"], 10)));
      return;
    }

    await messenger.send(chatId, `🕕 <b>Hora de comentar!</b> ${posts.length === 1 ? "1 sugestão" : `${posts.length} sugestões`} a seguir.`);
    for (const [i, post] of posts.entries()) {
      try {
        const draft = await drafter.draftComment(post, []);
        await store.updatePost(post.id, { draft, status: "drafted" });
        await messenger.send(chatId, draftCard({ ...post, draft }, { i: i + 1, total: posts.length }), draftButtons(post.id));
      } catch (err) {
        await messenger.send(chatId, `⚠️ Não consegui gerar a sugestão para ${esc(post.url)}: ${esc(String((err as Error).message))}`);
      }
    }
  }

  emptyDayMessage(missingText: Post[]): string {
    const parts = ["🕕 <b>Hora de comentar!</b> Hoje você não salvou nenhum post."];
    if (missingText.length) {
      parts.push(`Tem ${missingText.length} link(s) esperando o texto do post — mande /fila para ver.`);
    }
    if (this.perfil.criadores.length) {
      const list = this.perfil.criadores.map((c) => `• <a href="${esc(c.url)}">${esc(c.nome)}</a>`).join("\n");
      parts.push(`Que tal ver os posts recentes de alguém daqui? Mande o link do que gostar e depois /agora:\n${list}`);
    } else {
      parts.push("Abra o feed por 5 minutos, mande 2 ou 3 links pra cá e depois toque em /agora.");
    }
    return parts.join("\n\n");
  }
}
