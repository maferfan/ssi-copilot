import { detectLanguage } from "./language";
import { extractLinkedInUrl, extractPostUrn, textAroundUrl } from "./linkedin";
import type { Perfil } from "./perfil";
import type { TgUpdate } from "./telegram";
import type { Awaiting, Carousel, CarouselContent, Deps, InlineButton, Job, LinkedInConnection, Post, Recruiter, WeeklyMetrics } from "./types";
import { BATCH_SIZE, connectionNote, NOTES_PER_WEEK, selectCandidates, WEEKLY_RECRUITERS } from "./recruiters";
import { shiftWeek, weekKey, weekLabel, weekStartInstant } from "./week";

/** Quantos posts no máximo viram sugestão a cada rodada das 18h. */
export const DAILY_LIMIT = 3;

const BRT_OFFSET_MS = 3 * 3600 * 1000; // Brasília = UTC-3, sem horário de verão
const DAY_MS = 24 * 3600 * 1000;

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function excerpt(text: string | null, max = 280): string {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Data/hora "de parede" em Brasília, lida com os getters UTC. */
function brt(d: Date): Date {
  return new Date(d.getTime() - BRT_OFFSET_MS);
}

export function brWeekday(d: Date): number {
  return brt(d).getUTCDay();
}

function ddmm(d: Date): string {
  const b = brt(d);
  return `${String(b.getUTCDate()).padStart(2, "0")}/${String(b.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Quando sai o próximo carrossel: hoje às 18h se for sexta antes das 18h; senão, a próxima sexta. */
export function nextPublishLabel(now: Date): string {
  const b = brt(now);
  const day = b.getUTCDay();
  if (day === 5 && b.getUTCHours() < 18) return "hoje (sexta) às 18h";
  const days = (5 - day + 7) % 7 || 7;
  return `sexta, ${ddmm(new Date(now.getTime() + days * DAY_MS))}, às 18h`;
}

const HELP = `<b>Como funciona</b>

<b>Comentários</b>
1. Viu um post bom no LinkedIn? Mande o link pra cá (de preferência com o texto do post junto).
2. Todo dia às <b>18h</b> chegam até ${DAILY_LIMIT} sugestões de comentário.
3. ✅ Aprovar publica o comentário direto no LinkedIn. Também dá para pedir outra versão, editar ou pular.

<b>Carrossel de sexta</b>
1. Mande <code>/carrossel</code> e o tema, por exemplo: <code>/carrossel como escolher a stack de um site</code>
2. Eu monto os slides e mando a prévia.
3. Aprovado, ele é publicado na sexta às 18h.

<b>Recrutadores de domingo</b>
Domingo às 8h chega uma lista de ${WEEKLY_RECRUITERS} recrutadores (Brasil e internacional, só perfis em português ou inglês), em blocos de ${BATCH_SIZE}. Você abre cada link e toca em Conectar; os ${NOTES_PER_WEEK} primeiros vêm com nota pronta. Depois toque em ✔️ Enviei.

<b>Resumo e painel</b>
Domingo às 18h chega o resumo da semana e eu peço 3 números das Análises do LinkedIn (/metricas). Eles vão para o painel (/painel).

/conectar — conectar o LinkedIn (vale por 2 meses)
/agora — gerar as sugestões de comentário agora
/fila — ver os posts salvos
/semana — resumo da semana
/metricas — registrar os números da semana
/painel — link do dashboard
/recrutadores — gerar a lista de recrutadores agora`;

/** "120 3.400 215" → [120, 3400, 215]. Pontos e vírgulas são separadores de milhar. */
export function parseMetrics(text: string): [number, number, number] | null {
  const nums = (text.match(/\d[\d.,]*/g) ?? []).map((n) => Number(n.replace(/[.,]/g, "")));
  return nums.length === 3 && nums.every(Number.isFinite) ? [nums[0], nums[1], nums[2]] : null;
}

const METRICS_HOWTO = `Abra o seu perfil no LinkedIn → <b>Análises</b> e me mande 3 números, nesta ordem:
1. <b>Visualizações do perfil</b> (últimos 7 dias)
2. <b>Impressões dos posts</b> (últimos 7 dias)
3. <b>Seguidores</b> (total)

Exemplo: <code>120 3400 215</code>`;

export function recruiterBlock(rows: Recruiter[], index: number, total: number | null, offset: number): string {
  const lines = rows.map((r, i) => {
    const flag = r.language === "pt" ? "🇧🇷" : "🌎";
    const headline = r.headline ? `\n   <i>${esc(r.headline.slice(0, 90))}</i>` : "";
    const note = r.note ? `\n   📝 <code>${esc(r.note)}</code>` : "";
    return `${offset + i + 1}. <a href="${esc(r.url)}">${esc(r.name)}</a> ${flag}${headline}${note}`;
  });
  return `🤝 <b>Bloco ${index}${total ? `/${total}` : ""}</b>\n\n${lines.join("\n\n")}`;
}

export function draftCard(post: Post, index?: { i: number; total: number }): string {
  const head = index ? `📝 <b>Post ${index.i}/${index.total}</b>` : "📝 <b>Post</b>";
  return `${head} · ${esc(post.author ?? "autor desconhecido")}
<i>${esc(excerpt(post.text))}</i>
🔗 ${esc(post.url)}

💬 <b>Sugestão${detectLanguage(post.text) === "en" ? " (em inglês 🇺🇸)" : ""}:</b>
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

export function publishedCard(post: Post, text: string): string {
  return `✅ <b>Comentário publicado no LinkedIn</b> · ${esc(post.author ?? "post")}

${esc(text)}

🔗 ${esc(post.url)}`;
}

export function carouselCard(c: Carousel, when: string): string {
  const slides = c.content.slides.map((s, i) => `${i + 1}. ${esc(s.titulo)}`).join("\n");
  return `🎠 <b>Carrossel</b> · ${esc(c.topic)}

<b>${esc(c.content.titulo)}</b>
${slides}

<b>Legenda do post:</b>
${esc(c.content.legenda)}

Aprovando, ele é publicado ${when}.`;
}

export function carouselButtons(id: number): InlineButton[][] {
  return [
    [
      { text: "✅ Aprovar", data: `ca:${id}` },
      { text: "🔄 Refazer", data: `cr:${id}` },
    ],
    [
      { text: "✏️ Ajustar", data: `cj:${id}` },
      { text: "❌ Descartar", data: `cx:${id}` },
    ],
  ];
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

    const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
    if (cmd) {
      await this.setAwaiting(null);
      const arg = cmd[2].trim();
      switch (cmd[1].toLowerCase()) {
        case "start":
          await messenger.send(chatId, `Olá! Eu sou o seu SSI Copilot. 👋\n\n${HELP}`);
          return;
        case "agora":
          await this.schedule({ kind: "daily" }, "⏳ Gerando as sugestões… chegam em até 1 minuto.");
          return;
        case "fila":
          await this.sendQueue(chatId);
          return;
        case "semana":
          await this.sendWeek(chatId, false);
          return;
        case "metricas":
        case "métricas": {
          const week = weekKey(this.deps.now());
          const nums = parseMetrics(arg);
          if (nums) await this.saveMetrics(chatId, week, nums);
          else {
            await this.setAwaiting({ type: "metrics", week });
            await messenger.send(chatId, METRICS_HOWTO);
          }
          return;
        }
        case "recrutadores":
          await this.schedule({ kind: "invites" }, "🔎 Vou procurar recrutadores no LinkedIn (Brasil e internacional). A lista chega em 2–3 minutos.");
          return;
        case "painel":
        case "dashboard":
          await messenger.send(chatId, `📊 Painel: ${esc(await this.dashboardUrl())}`);
          return;
        case "conectar":
          await this.sendConnect(chatId);
          return;
        case "carrossel":
          if (arg) await this.requestCarousel(chatId, arg);
          else {
            await this.setAwaiting({ type: "carousel_topic" });
            await messenger.send(chatId, "Qual o tema do carrossel? Mande na próxima mensagem. 🎠");
          }
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
      // Comandos escritos junto com o link (ex.: "/agora") não fazem parte do texto do post
      const pasted = textAroundUrl(text, url)
        .split("\n")
        .filter((line) => !/^\/\w+/.test(line.trim()))
        .join("\n")
        .trim();
      await this.savePost(chatId, url, pasted);
      if (/(^|\s)\/agora\b/.test(text)) await this.schedule({ kind: "daily" }, "⏳ Gerando as sugestões… chegam em até 1 minuto.");
      return;
    }

    const awaiting = await this.getAwaiting();
    if (awaiting && text) {
      await this.setAwaiting(null);
      switch (awaiting.type) {
        case "post_text":
          await store.updatePost(awaiting.postId, { text, status: "pending" });
          await messenger.send(chatId, `Texto salvo ✔ ${await this.queueLine()}`);
          return;
        case "edit": {
          const post = await store.getPost(awaiting.postId);
          if (post) await this.publishComment(chatId, post, text);
          return;
        }
        case "carousel_topic":
          await this.requestCarousel(chatId, text);
          return;
        case "carousel_adjust": {
          const prev = await store.getCarousel(awaiting.carouselId);
          if (prev) await this.requestCarousel(chatId, prev.topic, prev.id, text);
          return;
        }
        case "metrics": {
          const nums = parseMetrics(text);
          if (nums) await this.saveMetrics(chatId, awaiting.week, nums);
          else {
            await this.setAwaiting(awaiting);
            await messenger.send(chatId, `Não entendi. Preciso de exatamente 3 números.\n\n${METRICS_HOWTO}`);
          }
          return;
        }
      }
    }

    await messenger.send(chatId, `Não encontrei um link do LinkedIn nessa mensagem.\n\n${HELP}`);
  }

  private async queueLine() {
    const n = (await this.deps.store.listPosts(["pending"], 100)).length;
    return n === 1 ? "1 post na fila para as 18h." : `${n} posts na fila para as 18h.`;
  }

  private async savePost(chatId: number, url: string, pastedText: string) {
    const { store, messenger, fetchPreview } = this.deps;
    const preview = await fetchPreview(url);
    const urn = extractPostUrn(preview?.url ?? url) ?? extractPostUrn(url);
    const finalUrl = preview?.url && extractPostUrn(preview.url) ? preview.url : url;

    // Texto colado junto com o link vale mais que a prévia (é o post inteiro)
    const text = pastedText.length >= 40 ? pastedText : preview?.text ?? null;
    if (text) {
      await store.addPost({ url: finalUrl, urn, author: preview?.author ?? null, text, status: "pending", createdAt: this.iso() });
      const who = preview?.author ? ` de ${esc(preview.author)}` : "";
      await messenger.send(chatId, `Post${who} salvo ✔ ${await this.queueLine()}`);
      return;
    }

    const id = await store.addPost({ url: finalUrl, urn, author: preview?.author ?? null, text: null, status: "needs_text", createdAt: this.iso() });
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

  private async dashboardUrl() {
    const base = (await this.deps.store.getSetting("public_url")) ?? "";
    return `${base}/dashboard`;
  }

  /** Ações da semana (segunda a domingo) comparadas com a anterior; no domingo, pede os números. */
  async sendWeek(chatId: number, askMetrics: boolean) {
    const { store, messenger } = this.deps;
    const week = weekKey(this.deps.now());
    const prevWeek = shiftWeek(week, -1);
    const actions = await store.listActionsSince(weekStartInstant(prevWeek).toISOString());
    const count = (w: string, type: string) => actions.filter((a) => a.type === type && weekKey(new Date(a.created_at)) === w).length;
    const line = (icon: string, label: string, type: string) => {
      const cur = count(week, type);
      const diff = cur - count(prevWeek, type);
      const cmp = diff === 0 ? "" : ` (${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs. semana passada)`;
      return `${icon} ${label}: <b>${cur}</b>${cmp}`;
    };
    const metrics = (await store.listMetrics(week)).find((m) => m.week === week);
    const parts = [
      `📊 <b>Semana de ${weekLabel(week)}</b>`,
      [line("💬", "Comentários", "comment"), line("🎠", "Carrosséis", "post"), line("🤝", "Convites", "invite")].join("\n"),
    ];
    if (metrics) parts.push(this.metricsLine(metrics));
    parts.push(`Painel: ${esc(await this.dashboardUrl())}`);
    if (askMetrics && !metrics) {
      await this.setAwaiting({ type: "metrics", week });
      parts.push(`Para fechar a semana:\n${METRICS_HOWTO}`);
    }
    await messenger.send(chatId, parts.join("\n\n"));
  }

  private metricsLine(m: WeeklyMetrics) {
    const nf = new Intl.NumberFormat("pt-BR");
    return `👀 Visualizações do perfil: <b>${nf.format(m.profile_views)}</b>\n📈 Impressões: <b>${nf.format(m.impressions)}</b>\n👥 Seguidores: <b>${nf.format(m.followers)}</b>`;
  }

  private async saveMetrics(chatId: number, week: string, [views, impressions, followers]: [number, number, number]) {
    const { store, messenger } = this.deps;
    const m: WeeklyMetrics = { week, profile_views: views, impressions, followers };
    await store.saveMetrics(m, this.iso());
    const prev = (await store.listMetrics(shiftWeek(week, -1))).find((x) => x.week === shiftWeek(week, -1));
    const diff = (a: number, b: number) => (a === b ? "igual" : `${a > b ? "+" : "−"}${new Intl.NumberFormat("pt-BR").format(Math.abs(a - b))}`);
    const cmp = prev
      ? `\n\nVs. semana passada: visualizações ${diff(views, prev.profile_views)}, impressões ${diff(impressions, prev.impressions)}, seguidores ${diff(followers, prev.followers)}.`
      : "";
    await messenger.send(chatId, `✅ Números da semana de ${weekLabel(week)} salvos.\n\n${this.metricsLine(m)}${cmp}\n\n📊 ${esc(await this.dashboardUrl())}`);
  }

  private async sendConnect(chatId: number) {
    const { linkedin, messenger } = this.deps;
    const url = await linkedin.connectUrl();
    if (!url) {
      await messenger.send(chatId, "O app do LinkedIn ainda não está configurado (faltam as chaves no GitHub).");
      return;
    }
    const conn = await linkedin.connection();
    const status = conn
      ? `✅ Conectado como <b>${esc(conn.name)}</b> até ${ddmm(new Date(conn.expiresAt))}.\nPara renovar agora, toque no link:`
      : "Toque no link, entre no LinkedIn e permita o acesso:";
    await messenger.send(chatId, `${status}\n\n🔗 <a href="${esc(url)}">Conectar o LinkedIn</a>\n\n<i>O link vale por 15 minutos.</i>`);
  }

  /** Chamado pela rota de retorno do OAuth. */
  async onLinkedInConnected(conn: LinkedInConnection) {
    const chatId = await this.ownerChat();
    if (chatId === null) return;
    await this.deps.messenger.send(
      chatId,
      `✅ LinkedIn conectado como <b>${esc(conn.name)}</b>. Vale até ${ddmm(new Date(conn.expiresAt))}; eu aviso antes de vencer.`,
    );
  }

  // ---------- comentários ----------

  /** Publica no LinkedIn; se não der, cai no modo copiar e colar e explica o motivo. */
  private async publishComment(chatId: number, post: Post, text: string, cardMessageId?: number) {
    const { linkedin, store, messenger } = this.deps;
    let reason: string;
    const conn = await linkedin.connection();
    if (conn && post.urn) {
      try {
        await linkedin.comment(post.urn, text);
        await store.updatePost(post.id, { status: "commented", final_comment: text });
        await store.logAction("comment", post.id, this.iso());
        const html = publishedCard(post, text);
        if (cardMessageId) await messenger.edit(chatId, cardMessageId, html);
        else await messenger.send(chatId, html);
        return;
      } catch (err) {
        reason = `o LinkedIn recusou (${esc(String((err as Error).message))})`;
      }
    } else {
      reason = conn ? "não achei o identificador do post nesse link" : "o LinkedIn não está conectado — mande /conectar";
    }

    await store.updatePost(post.id, { status: "approved", final_comment: text });
    const approved = { ...post, status: "approved" as const, final_comment: text };
    if (cardMessageId) await messenger.edit(chatId, cardMessageId, `${draftCard(post)}\n\n✅ <i>Aprovado</i>`);
    await messenger.send(chatId, `${approvedCard(approved)}\n\n⚠️ <i>Não publiquei sozinho: ${reason}.</i>`, [
      [{ text: "✔️ Já comentei", data: `d:${post.id}` }],
    ]);
  }

  // ---------- fila de trabalhos longos ----------

  /** No webhook, vai para a fila (e avisa); no cron e nos testes, roda na hora. */
  private async schedule(job: Job, notice: string) {
    const chatId = await this.ownerChat();
    if (chatId !== null) await this.deps.messenger.send(chatId, notice);
    if (this.deps.defer) await this.deps.defer(job);
    else await this.runJob(job);
  }

  async runJob(job: Job): Promise<void> {
    switch (job.kind) {
      case "daily":
        return this.runDaily();
      case "invites":
        return this.runInvites();
      case "carousel": {
        const prev = job.previousId ? await this.deps.store.getCarousel(job.previousId) : null;
        return this.createCarousel(job.chatId, job.topic, prev ?? undefined, job.instructions);
      }
    }
  }

  private requestCarousel(chatId: number, topic: string, previousId?: number, instructions?: string) {
    return this.schedule({ kind: "carousel", chatId, topic, previousId, instructions }, `🎨 Montando o carrossel sobre <b>${esc(topic)}</b>… a prévia chega em 1–2 minutos.`);
  }

  // ---------- carrossel ----------

  private async createCarousel(chatId: number, topic: string, previous?: Carousel, instructions?: string) {
    const { messenger, drafter, renderer, store } = this.deps;
    try {
      const content: CarouselContent = await drafter.draftCarousel(topic, previous?.content, instructions);
      const rendered = await renderer.render(content);
      const id = await store.addCarousel({ topic, content, createdAt: this.iso() });
      if (previous && previous.status === "draft") await store.updateCarousel(previous.id, { status: "discarded" });
      const carousel = (await store.getCarousel(id))!;
      await messenger.sendPhotos(chatId, rendered.images);
      await messenger.send(chatId, carouselCard(carousel, nextPublishLabel(this.deps.now())), carouselButtons(id));
    } catch (err) {
      await messenger.send(chatId, `⚠️ Não consegui montar o carrossel: ${esc(String((err as Error).message))}`);
    }
  }

  private async onCarouselButton(action: string, id: number, chatId: number, messageId: number, callbackId: string) {
    const { messenger, store } = this.deps;
    const c = await store.getCarousel(id);
    if (!c) {
      await messenger.answerCallback(callbackId, "Carrossel não encontrado.");
      return;
    }
    if (c.status !== "draft" && action !== "cx") {
      await messenger.answerCallback(callbackId, "Esse carrossel já foi decidido.");
      return;
    }
    const when = nextPublishLabel(this.deps.now());
    switch (action) {
      case "ca": {
        await messenger.answerCallback(callbackId, "Agendado!");
        const replaced = await store.listCarousels(["approved"]);
        for (const old of replaced) await store.updateCarousel(old.id, { status: "discarded" });
        await store.updateCarousel(id, { status: "approved" });
        const note = replaced.length ? "\n<i>Ele substitui o carrossel que estava agendado antes.</i>" : "";
        await messenger.edit(chatId, messageId, `${carouselCard(c, when)}\n\n✅ <b>Agendado: ${when}.</b>${note}`);
        return;
      }
      case "cr":
        await messenger.answerCallback(callbackId, "Refazendo…");
        await messenger.edit(chatId, messageId, `${carouselCard(c, when)}\n\n🔄 <i>Refeito abaixo.</i>`);
        await this.requestCarousel(chatId, c.topic, c.id);
        return;
      case "cj":
        await messenger.answerCallback(callbackId);
        await this.setAwaiting({ type: "carousel_adjust", carouselId: id });
        await messenger.send(chatId, "O que mudar? Ex.: <i>deixe o slide 3 mais técnico e troque o título da capa</i>. ✏️");
        return;
      case "cx":
        await messenger.answerCallback(callbackId, "Descartado");
        await store.updateCarousel(id, { status: "discarded" });
        await messenger.edit(chatId, messageId, `${carouselCard(c, when)}\n\n❌ <i>Descartado</i>`);
        return;
      default:
        await messenger.answerCallback(callbackId);
    }
  }

  /** Sexta, 18h: publica o carrossel aprovado. */
  async publishCarousel(): Promise<void> {
    const { store, messenger, renderer, linkedin } = this.deps;
    const chatId = await this.ownerChat();
    if (chatId === null) return;
    const approved = await store.listCarousels(["approved"]);
    const c = approved.at(-1);
    if (!c) {
      await messenger.send(chatId, "🎠 Sexta, 18h: não havia carrossel aprovado, então nada foi publicado esta semana.");
      return;
    }

    let rendered;
    try {
      rendered = await renderer.render(c.content);
      const url = await linkedin.publishCarousel(rendered, c.content.titulo, c.content.legenda);
      await store.updateCarousel(c.id, { status: "published", published_at: this.iso(), post_url: url });
      await store.logAction("post", c.id, this.iso());
      await messenger.send(chatId, `🚀 <b>Carrossel publicado!</b> · ${esc(c.topic)}\n\n🔗 ${esc(url)}`);
    } catch (err) {
      await store.updateCarousel(c.id, { status: "failed" });
      await messenger.send(chatId, `⚠️ Não consegui publicar o carrossel: ${esc(String((err as Error).message))}`);
      if (rendered) {
        await messenger.sendDocument(
          chatId,
          rendered.pdf,
          "carrossel.pdf",
          "Para publicar à mão: no LinkedIn, comece um post, toque em ➕ → Documento, envie este PDF e cole a legenda abaixo.",
        );
        await messenger.send(chatId, `<code>${esc(c.content.legenda)}</code>`);
      }
    }
  }

  /** Quinta, 18h: lembra do carrossel se nenhum estiver aprovado. */
  async remindCarousel(): Promise<void> {
    const chatId = await this.ownerChat();
    if (chatId === null) return;
    if ((await this.deps.store.listCarousels(["approved"])).length) return;
    await this.deps.messenger.send(
      chatId,
      "📅 Amanhã às 18h sai o carrossel da semana, mas nenhum está aprovado ainda.\nQual o tema? Mande <code>/carrossel</code> e o tema.",
    );
  }

  // ---------- recrutadores ----------

  /** Domingo, 8h: busca perfis novos e manda em blocos de 10, cada um com o botão "Enviei". */
  async runInvites(): Promise<void> {
    const { store, messenger, drafter } = this.deps;
    const chatId = await this.ownerChat();
    if (chatId === null) return;

    let picked;
    try {
      const known = await store.knownRecruiterUrls();
      picked = selectCandidates(await drafter.findRecruiters(known, WEEKLY_RECRUITERS + 15), known, WEEKLY_RECRUITERS);
    } catch (err) {
      await messenger.send(chatId, `⚠️ Não consegui buscar recrutadores: ${esc(String((err as Error).message))}`);
      return;
    }
    if (picked.length === 0) {
      await messenger.send(chatId, "Não achei perfis novos desta vez. Tente /recrutadores mais tarde.");
      return;
    }

    const week = weekKey(this.deps.now());
    // Se a lista já rodou nesta semana, os blocos novos continuam a numeração
    let first = 1;
    while ((await store.listRecruiterBatch(week, first)).length) first++;
    const rows = picked.map((c, i) => ({
      url: c.url,
      name: c.name,
      headline: c.headline || null,
      language: c.language,
      note: i < NOTES_PER_WEEK ? connectionNote(c.name, c.language) : null,
      week,
      batch: first + Math.floor(i / BATCH_SIZE),
      created_at: this.iso(),
    }));
    await store.addRecruiters(rows);

    const pt = picked.filter((c) => c.language === "pt").length;
    const total = Math.ceil(rows.length / BATCH_SIZE);
    await messenger.send(
      chatId,
      `🤝 <b>${rows.length} recrutadores para hoje</b> (${pt} 🇧🇷 · ${rows.length - pt} 🌎)

1. Abra cada link e toque em <b>Conectar</b>.
2. Nos ${Math.min(NOTES_PER_WEEK, rows.length)} primeiros, toque em <b>Adicionar nota</b> e cole a nota (o LinkedIn gratuito libera poucas por mês).
3. No fim de cada bloco, toque em <b>✔️ Enviei</b> para contar no resumo.`,
    );
    for (let b = 0; b < total; b++) {
      const batch = await store.listRecruiterBatch(week, first + b);
      await messenger.send(chatId, recruiterBlock(batch, b + 1, total, b * BATCH_SIZE), [
        [{ text: `✔️ Enviei estes ${batch.length}`, data: `iv:${week}:${first + b}` }],
      ]);
    }
  }

  private async onInvitesSent(data: string, chatId: number, messageId: number, callbackId: string) {
    const { store, messenger } = this.deps;
    const [, week, rawBatch] = data.split(":");
    const rows = await store.listRecruiterBatch(week, Number(rawBatch));
    const pending = rows.filter((r) => r.status === "suggested");
    if (pending.length === 0) {
      await messenger.answerCallback(callbackId, "Esse bloco já estava registrado.");
      return;
    }
    await messenger.answerCallback(callbackId, `${pending.length} convites registrados! 💪`);
    await store.markRecruitersInvited(pending.map((r) => r.id));
    for (const r of pending) await store.logAction("invite", r.id, this.iso());
    const index = Number(rawBatch);
    const done = rows.map((r) => ({ ...r, status: "invited" as const }));
    await messenger.edit(chatId, messageId, `${recruiterBlock(done, index, null, (index - 1) * BATCH_SIZE)}\n\n✔️ <i>${pending.length} convites registrados</i>`);
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
    if (action === "iv") return this.onInvitesSent(cb.data!, chatId, messageId, cb.id);
    if (action.startsWith("c")) return this.onCarouselButton(action, id, chatId, messageId, cb.id);

    const post = await store.getPost(id);
    if (!post) {
      await messenger.answerCallback(cb.id, "Post não encontrado.");
      return;
    }

    switch (action) {
      case "a": {
        if (post.status !== "drafted") {
          await messenger.answerCallback(cb.id, "Esse post já foi decidido.");
          return;
        }
        await messenger.answerCallback(cb.id, "Publicando…");
        await this.publishComment(chatId, post, post.draft ?? "", messageId);
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
        await messenger.send(chatId, "Mande a sua versão do comentário na próxima mensagem. Eu publico assim que chegar. ✏️");
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

  // ---------- agendamentos ----------

  /** Cron das 18h (Brasília): comentários todo dia, lembrete na quinta, carrossel na sexta, resumo no domingo. */
  async runScheduled(): Promise<void> {
    const day = brWeekday(this.deps.now());
    if (day === 5) await this.publishCarousel();
    await this.runDaily();
    if (day === 4) await this.remindCarousel();
    if (day === 0) {
      const chatId = await this.ownerChat();
      if (chatId !== null) await this.sendWeek(chatId, true);
    }
  }

  async runDaily(): Promise<void> {
    const { store, messenger, drafter, linkedin } = this.deps;
    const chatId = await this.ownerChat();
    if (chatId === null) return; // ninguém deu /start ainda

    const conn = await linkedin.connection();
    if (conn && new Date(conn.expiresAt).getTime() - this.deps.now().getTime() < 7 * DAY_MS) {
      await messenger.send(chatId, `🔑 A conexão com o LinkedIn vence em ${ddmm(new Date(conn.expiresAt))}. Mande /conectar para renovar.`);
    }

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
