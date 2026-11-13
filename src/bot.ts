import { detectLanguage } from "./language";
import { BR_MIN_SALARY, JOBS_PER_REGION, selectJobs, SENT_MEMORY } from "./jobs";
import { urlKey } from "./claude";
import { extractLinkedInUrl, extractPostUrn, isBoilerplate, isLoginWall, textAroundUrl } from "./linkedin";
import type { Perfil } from "./perfil";
import type { TgUpdate } from "./telegram";
import { NotAPostError, type Awaiting, type Carousel, type CarouselContent, type Deps, type InlineButton, type Job, type JobPosting, type LinkedInConnection, type Post, type TopicIdea, type Video, type WeeklyMetrics } from "./types";
import { TARGET_WORDS } from "./video";
import { shiftWeek, weekKey, weekLabel, weekStartInstant } from "./week";

/** Quantos posts no máximo viram sugestão a cada rodada das 18h. */
export const DAILY_LIMIT = 3;

/** Meta semanal de convites. O LinkedIn limita em torno de 100 por semana. */
export const WEEKLY_INVITE_GOAL = 50;

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

/** Data em Brasília, "AAAA-MM-DD". */
export function brDate(d: Date): string {
  return brt(d).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Primeira sexta que ainda dá para publicar: hoje, se for sexta antes das 18h; senão, a próxima. */
export function firstFriday(now: Date): string {
  const b = brt(now);
  const day = b.getUTCDay();
  if (day === 5 && b.getUTCHours() < 18) return brDate(now);
  return addDays(brDate(now), (5 - day + 7) % 7 || 7);
}

/** Próxima sexta sem carrossel agendado: se a primeira está ocupada, a seguinte, e assim por diante. */
export function nextFreeFriday(now: Date, taken: (string | null)[]): string {
  let date = firstFriday(now);
  while (taken.includes(date)) date = addDays(date, 7);
  return date;
}

/** "hoje (sexta) às 18h" ou "sexta, 13/11, às 18h". */
export function fridayLabel(date: string, now: Date): string {
  if (date === brDate(now)) return "hoje (sexta) às 18h";
  return `sexta, ${date.slice(8, 10)}/${date.slice(5, 7)}, às 18h`;
}

/** Quando sairia um carrossel aprovado agora (respeitando a fila de sextas). */
export function nextPublishLabel(now: Date, taken: (string | null)[] = []): string {
  return fridayLabel(nextFreeFriday(now, taken), now);
}

/** Telegram aceita até 4096 caracteres por mensagem. */
const TG_LIMIT = 4000;

function clip(html: string): string {
  return html.length > TG_LIMIT ? `${html.slice(0, TG_LIMIT - 1)}…` : html;
}

/** Mensagem 1: o texto para ler na gravação, limpo, na ordem. */
export function videoReadCard(v: Video): string {
  const s = v.script;
  const lines = [
    `🎬 <b>${esc(s.titulo)}</b>`,
    "",
    `🪑 <b>Abertura (você na câmera):</b>\n${esc(s.abertura)}`,
    "",
    ...s.trechos.map((t, i) => `${i + 1}. ${esc(t.fala)}`),
    "",
    `🏁 ${esc(s.fechamento)}`,
  ];
  return clip(lines.join("\n"));
}

/** Mensagem 2: duração, cenas, fontes, legenda e como gravar. */
export function videoScenesCard(v: Video): string {
  const s = v.script;
  const fora = s.palavras < TARGET_WORDS.min ? " (curto)" : s.palavras > TARGET_WORDS.max ? " (longo: vai passar de 1 min)" : "";
  const cenas = s.trechos.map((t, i) => `${i + 1}. ${t.destaque ? `<b>${esc(t.destaque)}</b> · ` : ""}<i>${esc(t.imagem)}</i>${t.fato_id ? ` [${esc(t.fato_id)}]` : ""}`);
  const fontes = s.fatos.length
    ? s.fatos.map((f) => `[${esc(f.id)}] ${esc(f.fato)} — <a href="${esc(f.url)}">${esc(f.fonte || "fonte")}</a>`)
    : ["<i>Nenhum estudo citado: o roteiro fala da ideia em termos gerais.</i>"];
  const custo = s.custo ? ` · US$ ${s.custo.usd.toFixed(2)}` : "";
  const lines = [
    `⏱️ ${s.palavras} palavras ≈ ${s.segundos} s${fora}${custo}`,
    "",
    "🖼️ <b>Cenas</b> (imagem que aparece em cima enquanto você fala):",
    ...cenas,
    "",
    "📚 <b>Fontes</b>",
    ...fontes,
    "",
    `📝 <b>Legenda</b>\n${esc(s.legenda)}`,
    "",
    "🎙️ <b>Como gravar:</b> um vídeo só, celular em pé, você sentado olhando para a câmera. Leia do começo ao fim com calma, pausando 1 segundo entre os trechos. Errou? Pause e repita a frase; dá para cortar depois.",
  ];
  return clip(lines.join("\n"));
}

export function videoButtons(id: number): InlineButton[][] {
  return [
    [
      { text: "🔄 Refazer", data: `vr:${id}` },
      { text: "✏️ Ajustar", data: `vj:${id}` },
    ],
    [{ text: "❌ Descartar", data: `vx:${id}` }],
  ];
}

const HELP = `<b>Como funciona</b>

<b>Comentários</b>
1. Viu um post bom no LinkedIn? Mande o link pra cá (de preferência com o texto do post junto).
2. Todo dia às <b>18h</b> chegam até ${DAILY_LIMIT} sugestões de comentário.
3. ✅ Aprovar publica o comentário direto no LinkedIn. Também dá para pedir outra versão, editar ou pular.

<b>Carrossel de sexta</b>
1. Mande <code>/carrossel</code> e o tema, por exemplo: <code>/carrossel como escolher a stack de um site</code>. Sem ideia? <code>/temas</code> sugere assuntos em alta.
2. Eu monto os slides e mando a prévia.
3. Aprovado, ele entra na próxima sexta livre, às 18h. Se a sexta já tiver um, vai para a seguinte.

<b>Convites</b>
Meta: ${WEEKLY_INVITE_GOAL} convites por semana. Mandou alguns? Registre com <code>/convites 10</code> (para corrigir, <code>/convites -2</code>). <code>/convites</code> sozinho mostra quantos faltam.

<b>Resumo e painel</b>
Domingo às 18h chega o resumo da semana e eu peço 3 números das Análises do LinkedIn (/metricas). Eles vão para o painel (/painel).

/video — roteiro de 1 minuto para Reels/TikTok (psicologia nos games)
/vagas — 5 vagas no Brasil e 5 no exterior (sai sozinho no sábado)
/temas — temas em alta para o próximo carrossel
/agenda — carrosséis agendados, por sexta
/status — versão do bot e situação da fila
/conectar — conectar o LinkedIn (vale por 2 meses)
/agora — gerar as sugestões de comentário agora
/fila — ver os posts salvos
/semana — resumo da semana
/metricas — registrar os números da semana
/painel — link do dashboard
/convites — registrar convites e ver quantos faltam`;

/** "/convites 12", "+12" ou "-3" → 12, 12, -3. */
export function parseInviteCount(text: string): number | null {
  const m = text.trim().match(/^([+-]?)\s*(\d{1,3})$/);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === "-" ? -n : n;
}

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
  const slides = c.content.slides
    .map((s, i) => {
      const g = s.grafico;
      const chart = !g ? "" : g.fonte ? ` · 📊 ${esc(g.fonte.nome)}${g.fonte.ano ? ` ${esc(g.fonte.ano)}` : ""}` : " · 📊 <i>ilustrativo</i>";
      return `${i + 1}. ${esc(s.titulo.replace(/\*\*/g, ""))}${chart}`;
    })
    .join("\n");
  const cg = c.content.capa_grafico;
  const cover = cg ? `\nCapa · 📊 ${cg.fonte ? `${esc(cg.fonte.nome)}${cg.fonte.ano ? ` ${esc(cg.fonte.ano)}` : ""}` : "<i>ilustrativo</i>"}` : "\nCapa · ⚠️ <i>sem gráfico</i>";
  const art = c.content.capa_imagem ? "\n🖼️ Ilustração gerada na capa" : "";
  const refs = c.content.referencias?.length ?? 0;
  const sources = refs ? `\n🔗 ${refs === 1 ? "1 fonte conferida" : `${refs} fontes conferidas`}, citadas embaixo de cada gráfico.` : "\n⚠️ <i>Nenhuma fonte conferida: todos os gráficos são ilustrativos.</i>";
  const k = c.content.custo;
  const cost = k
    ? `\n💰 ${(k.inputTokens / 1000).toFixed(1)}k tokens de entrada, ${(k.outputTokens / 1000).toFixed(1)}k de saída, ${k.searches} ${k.searches === 1 ? "busca" : "buscas"} ≈ US$ ${k.usd.toFixed(2)}`
    : "";
  return `🎠 <b>Carrossel</b> · ${esc(c.topic)}

<b>${esc(c.content.titulo.replace(/\*\*/g, ""))}</b>${cover}${art}
${slides}
${sources}${cost}

<b>Legenda do post:</b>
${esc(c.content.legenda)}

Aprovando, ele é publicado ${when}.`;
}

const AREA: Record<TopicIdea["area"], string> = { software: "⚙️ Software", frontend: "🎨 Front-end", ai: "🤖 IA" };

export function topicsMessage(items: TopicIdea[], usd: number): string {
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };
  const lines = items.map(
    (t, i) => `<b>${i + 1}. ${esc(t.titulo)}</b> · ${AREA[t.area]}
<i>${esc(t.gancho)}</i>
${esc(t.porque)}
${t.conferido === false ? "⚠️ fonte não conferida" : "🔗"} ${esc(t.fonte || host(t.url))}${t.url ? ` (${esc(host(t.url))})` : ""}`,
  );
  return `🔥 <b>Temas em alta</b> (software, front-end e IA)

${lines.join("\n\n")}

Toque no número para montar o carrossel daquele tema.
<i>Busca na web, não as métricas internas do LinkedIn · ≈ US$ ${usd.toFixed(2)}</i>`;
}

export function jobsMessage(jobs: JobPosting[], usd: number): string {
  const block = (list: JobPosting[], title: string) => {
    if (list.length === 0) return `${title}\n<i>Nenhuma vaga nova desta vez.</i>`;
    const items = list.map(
      (j, i) => `<b>${i + 1}. ${esc(j.titulo)}</b> · ${esc(j.empresa)}
📍 ${esc(j.local || "não informado")} · 💰 ${esc(j.salario)}${j.salario_ok ? "" : " ⚠️"}${j.aderencia ? ` · 🎯 ${j.aderencia}% de aderência` : ""}
${esc(j.motivo)}
🔗 ${esc(j.url)}`,
    );
    const short = list.length < JOBS_PER_REGION ? `\n<i>Só achei ${list.length} desta vez.</i>` : "";
    return `${title}\n\n${items.join("\n\n")}${short}`;
  };
  const br = jobs.filter((j) => j.regiao === "br");
  const intl = jobs.filter((j) => j.regiao === "intl");
  return `💼 <b>Vagas da semana</b>

${block(br, `🇧🇷 <b>Brasil</b> (a partir de R$ ${BR_MIN_SALARY.toLocaleString("pt-BR")})`)}

${block(intl, "🌎 <b>Exterior</b> (remoto, aceita quem mora no Brasil)")}

<i>⚠️ = o anúncio não informa salário dentro do mínimo; confira antes de se candidatar. Busca na web · ≈ US$ ${usd.toFixed(2)}</i>`;
}

export function topicButtons(n: number): InlineButton[][] {
  const buttons = Array.from({ length: n }, (_, i) => ({ text: `🎠 ${i + 1}`, data: `tp:${i}` }));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 4) rows.push(buttons.slice(i, i + 4));
  return rows;
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
    [{ text: "🖼️ Outra imagem", data: `ci:${id}` }],
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
        case "convites": {
          if (!arg) {
            await this.setAwaiting({ type: "invites" });
            await messenger.send(chatId, `${await this.invitesLine()}\n\nQuantos convites você mandou agora? Responda só com o número (ex.: <code>10</code>).`);
            return;
          }
          const n = parseInviteCount(arg);
          if (n === null) await messenger.send(chatId, "Mande só o número, por exemplo: <code>/convites 10</code> (ou <code>/convites -2</code> para corrigir).");
          else await this.addInvites(chatId, n);
          return;
        }
        case "painel":
        case "dashboard":
          await messenger.send(chatId, `📊 Painel: ${esc(await this.dashboardUrl())}`);
          return;
        case "conectar":
          await this.sendConnect(chatId);
          return;
        case "vagas":
          await this.schedule({ kind: "jobs", chatId }, "💼 Procurando vagas que combinam com o seu currículo (Brasil e exterior)… chegam em 2–3 minutos.");
          return;
        case "temas":
          await this.schedule({ kind: "topics", chatId }, "🔎 Procurando o que está em alta em software, front-end e IA… os temas chegam em 1–2 minutos.");
          return;
        case "agenda":
          await this.sendAgenda(chatId);
          return;
        case "carrossel":
          if (arg) await this.requestCarousel(chatId, arg);
          else {
            await this.setAwaiting({ type: "carousel_topic" });
            await messenger.send(chatId, "Qual o tema do carrossel? Mande na próxima mensagem. 🎠");
          }
          return;
        case "video":
        case "vídeo":
          if (arg) await this.requestVideo(chatId, arg);
          else {
            await this.setAwaiting({ type: "video_topic" });
            await messenger.send(chatId, "Qual o tema do vídeo? Ex.: <i>por que é difícil largar uma missão pela metade</i>. 🎬");
          }
          return;
        case "ajuda":
        case "help":
          await messenger.send(chatId, HELP);
          return;
        case "status":
          await this.sendStatus(chatId);
          return;
        default:
          await messenger.send(chatId, `Não conheço o comando <code>/${esc(cmd[1])}</code>.\n\n${HELP}`);
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
        case "carousel_image":
          await this.schedule({ kind: "image", chatId, carouselId: awaiting.carouselId, scene: text }, "🖼️ Gerando a imagem com essa cena… a prévia chega em até 1 minuto.");
          return;
        case "carousel_adjust": {
          const prev = await store.getCarousel(awaiting.carouselId);
          if (prev) await this.requestCarousel(chatId, prev.topic, prev.id, text);
          return;
        }
        case "video_topic":
          await this.requestVideo(chatId, text);
          return;
        case "video_adjust": {
          const prev = await store.getVideo(awaiting.videoId);
          if (prev) await this.requestVideo(chatId, prev.topic, prev.id, text);
          return;
        }
        case "invites": {
          const n = parseInviteCount(text);
          if (n === null) {
            await this.setAwaiting(awaiting);
            await messenger.send(chatId, "Não entendi. Responda só com o número de convites (ex.: <code>10</code>).");
          } else await this.addInvites(chatId, n);
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

    // Texto longo sem link: é o texto do último post salvo (ex.: colado depois que a prévia falhou)
    if (text.length >= 80 && (await this.attachTextToRecentPost(chatId, text))) return;

    await messenger.send(chatId, `Não encontrei um link do LinkedIn nessa mensagem.\n\n${HELP}`);
  }

  /** Usa o texto colado no post salvo mais recente (últimas 3 h) que ainda não virou comentário. */
  private async attachTextToRecentPost(chatId: number, text: string): Promise<boolean> {
    const { store, messenger } = this.deps;
    const since = new Date(this.deps.now().getTime() - 3 * 3600 * 1000).toISOString();
    const recent = (await store.listPosts(["needs_text", "pending", "drafted"], 100)).filter((p) => p.created_at >= since).at(-1);
    if (!recent) return false;
    await store.updatePost(recent.id, { text, status: "pending", draft: null });
    await messenger.send(chatId, `Texto salvo no post ${esc(recent.url)} ✔ ${await this.queueLine()}\nMande /agora para gerar a sugestão já.`);
    return true;
  }

  /** O texto salvo não é o post: volta a pedir o texto, sem mostrar sugestão. */
  private async askForRealText(chatId: number, post: Post) {
    await this.deps.store.updatePost(post.id, { status: "needs_text", text: null, draft: null });
    await this.setAwaiting({ type: "post_text", postId: post.id });
    await this.deps.messenger.send(
      chatId,
      `⚠️ O texto salvo de ${esc(post.url)} não era o post (o LinkedIn mostrou a tela de login).\nCopie o texto do post e cole aqui na próxima mensagem.`,
    );
  }

  private async queueLine() {
    const n = (await this.deps.store.listPosts(["pending"], 100)).length;
    return n === 1 ? "1 post na fila para as 18h." : `${n} posts na fila para as 18h.`;
  }

  private async savePost(chatId: number, url: string, pastedText: string) {
    const { store, messenger, fetchPreview } = this.deps;
    const preview = await fetchPreview(url);
    const resolved = preview?.url && !isLoginWall(preview.url) ? preview.url : null;
    const urn = extractPostUrn(resolved ?? url) ?? extractPostUrn(url);
    const finalUrl = resolved && extractPostUrn(resolved) ? resolved : url;

    // Texto colado junto com o link vale mais que a prévia (é o post inteiro)
    const text = pastedText.length >= 40 ? pastedText : isBoilerplate(preview?.text ?? null) ? null : preview?.text ?? null;
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
    const count = (w: string, type: string) =>
      actions.filter((a) => a.type === type && weekKey(new Date(a.created_at)) === w).reduce((sum, a) => sum + (a.value ?? 1), 0);
    const line = (icon: string, label: string, type: string) => {
      const cur = count(week, type);
      const diff = cur - count(prevWeek, type);
      const cmp = diff === 0 ? "" : ` (${diff > 0 ? "+" : "−"}${Math.abs(diff)} vs. semana passada)`;
      return `${icon} ${label}: <b>${cur}</b>${cmp}`;
    };
    const metrics = (await store.listMetrics(week)).find((m) => m.week === week);
    const parts = [
      `📊 <b>Semana de ${weekLabel(week)}</b>`,
      [line("💬", "Comentários", "comment"), line("🎠", "Carrosséis", "post"), this.goalLine(count(week, "invite"))].join("\n"),
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
      case "carousel": {
        const prev = job.previousId ? await this.deps.store.getCarousel(job.previousId) : null;
        return this.createCarousel(job.chatId, job.topic, prev ?? undefined, job.instructions);
      }
      case "topics":
        return this.sendTopics(job.chatId);
      case "jobs":
        return this.sendJobs(job.chatId);
      case "image":
        return this.regenerateImage(job.chatId, job.carouselId, job.scene);
      case "video": {
        const prev = job.previousId ? await this.deps.store.getVideo(job.previousId) : null;
        return this.createVideo(job.chatId, job.topic, prev ?? undefined, job.instructions);
      }
    }
  }

  // ---------- vídeo (Reels/TikTok) ----------

  private requestVideo(chatId: number, topic: string, previousId?: number, instructions?: string) {
    return this.schedule({ kind: "video", chatId, topic, previousId, instructions }, `🎬 Escrevendo o roteiro sobre <b>${esc(topic)}</b>… chega em 1–2 minutos.`);
  }

  private async createVideo(chatId: number, topic: string, previous?: Video, instructions?: string) {
    const { messenger, drafter, store } = this.deps;
    try {
      const script = await drafter.draftVideo(topic, previous?.script, instructions);
      const id = await store.addVideo({ topic, script, createdAt: this.iso() });
      if (previous && previous.status === "draft") await store.updateVideoStatus(previous.id, "discarded");
      const video = (await store.getVideo(id))!;
      await messenger.send(chatId, videoReadCard(video));
      await messenger.send(chatId, videoScenesCard(video), videoButtons(id));
    } catch (err) {
      await messenger.send(chatId, `⚠️ Não consegui escrever o roteiro: ${esc(String((err as Error).message))}`);
    }
  }

  private async onVideoButton(action: string, id: number, chatId: number, messageId: number, callbackId: string) {
    const { messenger, store } = this.deps;
    const v = await store.getVideo(id);
    if (!v) {
      await messenger.answerCallback(callbackId, "Roteiro não encontrado.");
      return;
    }
    if (v.status !== "draft") {
      await messenger.answerCallback(callbackId, "Esse roteiro já foi decidido.");
      return;
    }
    switch (action) {
      case "vr":
        await messenger.answerCallback(callbackId, "Refazendo…");
        await messenger.edit(chatId, messageId, `${videoScenesCard(v)}\n\n🔄 <i>Refeito abaixo.</i>`);
        await this.requestVideo(chatId, v.topic, v.id);
        return;
      case "vj":
        await messenger.answerCallback(callbackId);
        await this.setAwaiting({ type: "video_adjust", videoId: id });
        await messenger.send(chatId, "O que mudar? Ex.: <i>troque o gancho por uma pergunta e use Dark Souls como exemplo</i>. ✏️");
        return;
      case "vx":
        await messenger.answerCallback(callbackId, "Descartado");
        await store.updateVideoStatus(id, "discarded");
        await messenger.edit(chatId, messageId, `${videoScenesCard(v)}\n\n❌ <i>Descartado</i>`);
        return;
      default:
        await messenger.answerCallback(callbackId);
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
      // Ajuste reaproveita a ilustração; tema novo ou "Refazer" gera outra
      const keep = instructions ? previous?.content.capa_imagem : undefined;
      const art = keep ?? (content.imagem_prompt && this.deps.illustrator ? await this.deps.illustrator.generate(content.imagem_prompt) : null);
      if (art) content.capa_imagem = art;
      await this.sendNewVersion(chatId, topic, content, previous);
    } catch (err) {
      await messenger.send(chatId, `⚠️ Não consegui montar o carrossel: ${esc(String((err as Error).message))}`);
    }
  }

  /** Salva a nova versão, descarta o rascunho anterior e manda a prévia com o cartão. */
  private async sendNewVersion(chatId: number, topic: string, content: CarouselContent, previous?: Carousel) {
    const { messenger, renderer, store } = this.deps;
    const rendered = await renderer.render(content);
    const id = await store.addCarousel({ topic, content, createdAt: this.iso() });
    if (previous && previous.status === "draft") await store.updateCarousel(previous.id, { status: "discarded" });
    const carousel = (await store.getCarousel(id))!;
    await messenger.sendPhotos(chatId, rendered.images);
    await messenger.send(chatId, carouselCard(carousel, await this.nextSlotLabel()), carouselButtons(id));
  }

  /** Só troca a ilustração da capa: o texto e os gráficos ficam iguais. */
  private async regenerateImage(chatId: number, carouselId: number, scene?: string) {
    const { messenger, store, drafter, illustrator } = this.deps;
    const prev = await store.getCarousel(carouselId);
    if (!prev || prev.status !== "draft") {
      await messenger.send(chatId, "Esse carrossel já foi decidido; a imagem não pode mais mudar.");
      return;
    }
    if (!illustrator) {
      await messenger.send(chatId, "A geração de imagens não está ativa neste bot.");
      return;
    }
    try {
      const prompt = scene ? await drafter.sceneToPrompt(scene) : prev.content.imagem_prompt;
      if (!prompt) {
        await messenger.send(chatId, "Esse carrossel não tem uma cena descrita. Toque em 🖼️ Outra imagem e escreva a cena.");
        return;
      }
      const art = await illustrator.generate(prompt);
      if (!art) {
        await messenger.send(chatId, "⚠️ Não consegui gerar a imagem agora (a cota grátis do dia pode ter acabado). Tente de novo mais tarde.");
        return;
      }
      await this.sendNewVersion(chatId, prev.topic, { ...prev.content, imagem_prompt: prompt, capa_imagem: art }, prev);
    } catch (err) {
      await messenger.send(chatId, `⚠️ Não consegui trocar a imagem: ${esc(String((err as Error).message))}`);
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
    const when = await this.nextSlotLabel();
    switch (action) {
      case "ca": {
        await messenger.answerCallback(callbackId, "Agendado!");
        const queue = await store.listCarousels(["approved"]);
        const slot = nextFreeFriday(this.deps.now(), queue.map((q) => q.scheduled_for));
        await store.updateCarousel(id, { status: "approved", scheduled_for: slot });
        const label = fridayLabel(slot, this.deps.now());
        const note = queue.length ? `\n<i>${queue.length === 1 ? "Já há 1 carrossel" : `Já há ${queue.length} carrosséis`} na fila antes dele. Veja em /agenda.</i>` : "";
        await messenger.edit(chatId, messageId, `${carouselCard(c, label)}\n\n✅ <b>Agendado: ${label}.</b>${note}`);
        return;
      }
      case "cr":
        await messenger.answerCallback(callbackId, "Refazendo…");
        await messenger.edit(chatId, messageId, `${carouselCard(c, when)}\n\n🔄 <i>Refeito abaixo.</i>`);
        await this.requestCarousel(chatId, c.topic, c.id);
        return;
      case "ci":
        await messenger.answerCallback(callbackId);
        await this.setAwaiting({ type: "carousel_image", carouselId: id });
        await messenger.send(
          chatId,
          "🖼️ Descreva a cena que você quer na capa (pode ser em português), por exemplo: <i>uma pessoa olhando o relógio enquanto a página carrega</i>.\nOu gere outra com a mesma ideia:",
          [[{ text: "🎲 Outra com a mesma ideia", data: `cn:${id}` }]],
        );
        return;
      case "cn":
        await messenger.answerCallback(callbackId, "Gerando…");
        await this.setAwaiting(null);
        await this.schedule({ kind: "image", chatId, carouselId: id }, "🖼️ Gerando outra imagem… a prévia chega em até 1 minuto.");
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

  private async nextSlotLabel(): Promise<string> {
    const queue = await this.deps.store.listCarousels(["approved"]);
    return nextPublishLabel(this.deps.now(), queue.map((q) => q.scheduled_for));
  }

  /** /agenda: carrosséis aprovados, na ordem das sextas. */
  private async sendAgenda(chatId: number) {
    const queue = (await this.deps.store.listCarousels(["approved"])).sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));
    if (queue.length === 0) {
      await this.deps.messenger.send(chatId, "📅 Nenhum carrossel agendado. Mande <code>/carrossel</code> e o tema.");
      return;
    }
    const lines = queue.map((q) => `• ${q.scheduled_for ? fridayLabel(q.scheduled_for, this.deps.now()) : "próxima sexta"} — ${esc(q.content.titulo.replace(/\*\*/g, ""))}`);
    await this.deps.messenger.send(chatId, `📅 <b>Carrosséis agendados</b>\n\n${lines.join("\n")}\n\n<i>Para tirar um da fila, toque em ❌ Descartar no cartão dele.</i>`);
  }

  // ---------- /status ----------

  /** Versão publicada e situação da fila: para descobrir se algo travou sem abrir a Cloudflare. */
  private async sendStatus(chatId: number) {
    const { store, messenger } = this.deps;
    const counts = await store.jobCounts();
    const beat = await store.getSetting("queue_heartbeat");
    const ago = beat ? Math.round((this.deps.now().getTime() - new Date(beat).getTime()) / 60000) : null;
    const queue =
      ago === null
        ? "⚠️ a fila nunca rodou (o agendamento de cada minuto não está ativo)"
        : ago <= 2
          ? `✅ rodou há ${ago} min`
          : `⚠️ não roda há ${ago} min (o agendamento de cada minuto parou)`;
    await messenger.send(
      chatId,
      `🩺 <b>Status</b>

Versão: <code>${esc(this.deps.version ?? "desconhecida")}</code>
Fila: ${queue}
Pedidos: ${counts.pending ?? 0} esperando · ${counts.running ?? 0} rodando · ${counts.failed ?? 0} com erro · ${counts.done ?? 0} feitos`,
    );
  }

  // ---------- /vagas ----------

  /** Sábado, 10h (ou /vagas): 5 vagas no Brasil e 5 no exterior, sem repetir as já enviadas. */
  async sendJobs(chatId: number): Promise<void> {
    const { drafter, store, messenger } = this.deps;
    const sent = JSON.parse((await store.getSetting("jobs_sent")) ?? "[]") as string[];
    let found;
    try {
      found = await drafter.findJobs(sent);
    } catch (err) {
      await messenger.send(chatId, `⚠️ Não consegui buscar as vagas: ${esc(String((err as Error).message))}`);
      return;
    }
    const jobs = selectJobs(found.items, found.links, sent, urlKey);
    if (jobs.length === 0) {
      await messenger.send(chatId, `Não achei vagas novas desta vez (o Claude sugeriu ${found.items.length}, a busca trouxe ${found.links.size} links). Tente /vagas de novo mais tarde.`);
      return;
    }
    const keys = jobs.map((j) => urlKey(j.url)).filter((k): k is string => Boolean(k));
    await store.setSetting("jobs_sent", JSON.stringify([...sent, ...keys].slice(-SENT_MEMORY)));
    await messenger.send(chatId, jobsMessage(jobs, found.custo.usd));
  }

  // ---------- /temas ----------

  /** Pesquisa os assuntos em alta e manda a lista com um botão por tema. */
  async sendTopics(chatId: number): Promise<void> {
    const { drafter, store, messenger } = this.deps;
    let found;
    try {
      found = await drafter.suggestTopics();
    } catch (err) {
      await messenger.send(chatId, `⚠️ Não consegui buscar os temas: ${esc(String((err as Error).message))}`);
      return;
    }
    if (found.items.length === 0) {
      await messenger.send(
        chatId,
        `Não achei temas desta vez (o Claude sugeriu ${found.sugeridos}, a busca trouxe ${found.links} links). Tente /temas de novo daqui a pouco.`,
      );
      return;
    }
    await store.setSetting("topics", JSON.stringify(found.items));
    await messenger.send(chatId, topicsMessage(found.items, found.custo.usd), topicButtons(found.items.length));
  }

  private async onTopicChosen(index: number, chatId: number, callbackId: string) {
    const raw = await this.deps.store.getSetting("topics");
    const topic = raw ? (JSON.parse(raw) as TopicIdea[])[index] : undefined;
    if (!topic) {
      await this.deps.messenger.answerCallback(callbackId, "Essa lista expirou. Mande /temas de novo.");
      return;
    }
    await this.deps.messenger.answerCallback(callbackId, "Montando o carrossel…");
    await this.requestCarousel(chatId, topic.gancho ? `${topic.titulo} — ${topic.gancho}` : topic.titulo);
  }

  /** Sexta, 18h: publica o carrossel agendado para hoje. */
  async publishCarousel(): Promise<void> {
    const { store, messenger, renderer, linkedin } = this.deps;
    const chatId = await this.ownerChat();
    if (chatId === null) return;
    // Sai o agendado para hoje (ou um atrasado, se uma sexta passou sem publicar); os outros esperam a vez
    const today = brDate(this.deps.now());
    const queue = await store.listCarousels(["approved"]);
    const c = queue
      .filter((q) => !q.scheduled_for || q.scheduled_for <= today)
      .sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""))[0];
    if (!c) {
      const next = queue.filter((q) => q.scheduled_for).sort((a, b) => a.scheduled_for!.localeCompare(b.scheduled_for!))[0];
      const tail = next ? ` O próximo sai ${fridayLabel(next.scheduled_for!, this.deps.now())}.` : "";
      await messenger.send(chatId, `🎠 Sexta, 18h: não havia carrossel agendado para hoje, então nada foi publicado.${tail}`);
      return;
    }

    let rendered;
    try {
      rendered = await renderer.render(c.content);
      // O **destaque** vira cor no slide; no título do documento do LinkedIn sairia com os asteriscos
      const url = await linkedin.publishCarousel(rendered, c.content.titulo.replace(/\*\*/g, ""), c.content.legenda);
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
    const tomorrow = addDays(brDate(this.deps.now()), 1);
    const queue = await this.deps.store.listCarousels(["approved"]);
    if (queue.some((q) => !q.scheduled_for || q.scheduled_for <= tomorrow)) return;
    await this.deps.messenger.send(
      chatId,
      "📅 Amanhã às 18h sai o carrossel da semana, mas nenhum está aprovado ainda.\nQual o tema? Mande <code>/carrossel</code> e o tema.",
    );
  }

  // ---------- convites ----------

  /** Convites da semana atual (segunda a domingo). */
  private async invitesThisWeek(): Promise<number> {
    const week = weekKey(this.deps.now());
    const actions = await this.deps.store.listActionsSince(weekStartInstant(week).toISOString());
    return actions.filter((a) => a.type === "invite").reduce((sum, a) => sum + (a.value ?? 1), 0);
  }

  private goalLine(total: number): string {
    const left = WEEKLY_INVITE_GOAL - total;
    const status = left > 0 ? `faltam <b>${left}</b>` : left === 0 ? "meta batida! 🎉" : `meta batida, +${-left} 🎉`;
    return `🤝 Convites: <b>${total}</b> de ${WEEKLY_INVITE_GOAL} (${status})`;
  }

  private async invitesLine(): Promise<string> {
    return this.goalLine(await this.invitesThisWeek());
  }

  /** Soma (ou corrige, com número negativo) os convites da semana. */
  async addInvites(chatId: number, n: number): Promise<void> {
    const { store, messenger } = this.deps;
    if (n === 0) {
      await messenger.send(chatId, await this.invitesLine());
      return;
    }
    const current = await this.invitesThisWeek();
    if (current + n < 0) {
      await messenger.send(chatId, `Esta semana só há ${current} convites registrados; não dá para tirar ${-n}.`);
      return;
    }
    await store.logAction("invite", null, this.iso(), n);
    const total = current + n;
    const warn = total > 100 ? "\n\n⚠️ Acima de ~100 por semana o LinkedIn pode limitar a conta." : "";
    await messenger.send(chatId, `${n > 0 ? `✔️ +${n} registrados.` : `✔️ ${n} corrigidos.`}\n${this.goalLine(total)}${warn}`);
  }

  /** Avisa no Telegram quando algo que roda sozinho falha (cron e fila). */
  async reportFailure(what: string, err: unknown): Promise<void> {
    const chatId = await this.ownerChat();
    if (chatId === null) return;
    const reason = err instanceof Error ? err.message : String(err);
    await this.deps.messenger.send(chatId, `⚠️ <b>${esc(what)}</b> falhou: ${esc(reason.slice(0, 300))}\n\nDetalhes no painel da Cloudflare → Workers &amp; Pages → ssi-copilot → Logs.`);
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
    if (action === "tp") return this.onTopicChosen(id, chatId, cb.id);
    if (action.startsWith("c")) return this.onCarouselButton(action, id, chatId, messageId, cb.id);
    if (action.startsWith("v")) return this.onVideoButton(action, id, chatId, messageId, cb.id);

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
          if (err instanceof NotAPostError) await this.askForRealText(chatId, post);
          else await messenger.send(chatId, `Não consegui gerar outra versão agora: ${esc(String((err as Error).message))}`);
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
        if (isBoilerplate(post.text)) throw new NotAPostError();
        const draft = await drafter.draftComment(post, []);
        await store.updatePost(post.id, { draft, status: "drafted" });
        await messenger.send(chatId, draftCard({ ...post, draft }, { i: i + 1, total: posts.length }), draftButtons(post.id));
      } catch (err) {
        if (err instanceof NotAPostError) await this.askForRealText(chatId, post);
        else await messenger.send(chatId, `⚠️ Não consegui gerar a sugestão para ${esc(post.url)}: ${esc(String((err as Error).message))}`);
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
