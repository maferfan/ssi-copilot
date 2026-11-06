import { describe, expect, it } from "vitest";
import { Bot, DAILY_LIMIT, nextPublishLabel } from "../src/bot";
import { perfil } from "../src/perfil";
import { click, makeDeps, msg, OWNER } from "./fakes";

const URL = "https://www.linkedin.com/posts/fulana_entrevistas-activity-1";
const LONG_TEXT = "Os 5 erros mais comuns em entrevistas técnicas e como evitar cada um deles.";

async function setup(over: Parameters<typeof makeDeps>[0] = {}) {
  const ctx = makeDeps(over);
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  return { ...ctx, bot };
}

describe("dono do bot", () => {
  it("o primeiro /start vira dono e estranhos são recusados", async () => {
    const { bot, store, messenger } = await setup();
    expect(store.settings.get("owner_chat_id")).toBe(String(OWNER));

    await bot.handleUpdate(msg(`${URL} ${LONG_TEXT}`, 999));
    expect(messenger.last().chatId).toBe(999);
    expect(messenger.last().html).toContain("bot pessoal");
    expect(store.posts).toHaveLength(0);
  });

  it("OWNER_CHAT_ID configurado tem prioridade sobre o /start", async () => {
    const { deps, store } = makeDeps({ ownerChatId: 7 });
    const bot = new Bot(deps, perfil);
    await bot.handleUpdate(msg("/start", 8));
    expect(store.settings.has("owner_chat_id")).toBe(false);
  });
});

describe("salvar posts", () => {
  it("link com o texto colado entra direto na fila", async () => {
    const { bot, store, messenger } = await setup();
    await bot.handleUpdate(msg(`${LONG_TEXT}\n${URL}`));
    expect(store.posts[0]).toMatchObject({ url: URL, text: LONG_TEXT, status: "pending" });
    expect(messenger.last().html).toContain("1 post na fila");
  });

  it("só o link: usa a prévia pública quando o LinkedIn deixa", async () => {
    const { bot, store, messenger } = await setup({ preview: { author: "Fulana", text: LONG_TEXT } });
    await bot.handleUpdate(msg(URL));
    expect(store.posts[0]).toMatchObject({ author: "Fulana", text: LONG_TEXT, status: "pending" });
    expect(messenger.last().html).toContain("de Fulana salvo");
  });

  it("só o link sem prévia: pede o texto e completa com a próxima mensagem", async () => {
    const { bot, store, messenger } = await setup({ preview: null });
    await bot.handleUpdate(msg(URL));
    expect(store.posts[0].status).toBe("needs_text");
    expect(messenger.last().html).toContain("cole aqui");

    await bot.handleUpdate(msg(LONG_TEXT));
    expect(store.posts[0]).toMatchObject({ text: LONG_TEXT, status: "pending" });
  });

  it("mensagem sem link e sem nada pendente recebe a ajuda", async () => {
    const { bot, store, messenger } = await setup();
    await bot.handleUpdate(msg("oi"));
    expect(store.posts).toHaveLength(0);
    expect(messenger.last().html).toContain("Não encontrei um link");
  });
});

describe("rodada das 18h", () => {
  it(`gera uma sugestão por post, no máximo ${DAILY_LIMIT}`, async () => {
    const { bot, store, messenger, drafter } = await setup();
    for (let i = 0; i < DAILY_LIMIT + 2; i++) await bot.handleUpdate(msg(`${LONG_TEXT} ${i}\n${URL}-${i}`));
    messenger.sent = [];

    await bot.runDaily();
    expect(drafter.calls).toHaveLength(DAILY_LIMIT);
    const cards = messenger.sent.filter((s) => s.buttons);
    expect(cards).toHaveLength(DAILY_LIMIT);
    expect(cards[0].html).toContain(`Post 1/${DAILY_LIMIT}`);
    expect(cards[0].html).toContain("Comentário 1");
    expect(store.posts.filter((p) => p.status === "pending")).toHaveLength(2);
  });

  it("sem posts salvos manda um lembrete em vez de sugestões", async () => {
    const { bot, messenger, drafter } = await setup();
    await bot.runDaily();
    expect(drafter.calls).toHaveLength(0);
    expect(messenger.last().html).toContain("não salvou nenhum post");
  });

  it("não faz nada antes de alguém dar /start", async () => {
    const { deps, messenger } = makeDeps();
    await new Bot(deps, perfil).runDaily();
    expect(messenger.sent).toHaveLength(0);
  });

  it("um erro num post não derruba os outros", async () => {
    const ctx = await setup();
    let n = 0;
    ctx.deps.drafter.draftComment = async () => {
      if (++n === 1) throw new Error("falhou");
      return "ok";
    };
    await ctx.bot.handleUpdate(msg(`${LONG_TEXT}\n${URL}-a`));
    await ctx.bot.handleUpdate(msg(`${LONG_TEXT}\n${URL}-b`));
    await ctx.bot.runDaily();
    expect(ctx.messenger.sent.some((s) => s.html.includes("Não consegui gerar"))).toBe(true);
    expect(ctx.store.posts[1].status).toBe("drafted");
  });
});

describe("botões", () => {
  async function drafted() {
    const ctx = await setup();
    await ctx.bot.handleUpdate(msg(`${LONG_TEXT}\n${URL}`));
    await ctx.bot.runDaily();
    return ctx;
  }

  it("aprovar manda o texto pronto para copiar; 'Já comentei' registra uma vez", async () => {
    const { bot, store, messenger } = await drafted();
    await bot.handleUpdate(click("a:1"));
    expect(store.posts[0]).toMatchObject({ status: "approved", final_comment: "Comentário 1" });
    expect(messenger.last().html).toContain("<code>Comentário 1</code>");
    expect(messenger.last().buttons?.[0][0].data).toBe("d:1");

    await bot.handleUpdate(click("d:1"));
    await bot.handleUpdate(click("d:1"));
    expect(store.posts[0].status).toBe("commented");
    expect(store.actions).toHaveLength(1);
    expect(store.actions[0]).toMatchObject({ type: "comment", refId: 1 });
  });

  it("outra versão manda a anterior para o Claude evitar", async () => {
    const { bot, store, messenger, drafter } = await drafted();
    await bot.handleUpdate(click("r:1"));
    expect(drafter.calls[1].avoid).toEqual(["Comentário 1"]);
    expect(store.posts[0].draft).toBe("Comentário 2");
    expect(messenger.edits.at(-1)?.html).toContain("Comentário 2");
  });

  it("editar usa a próxima mensagem como comentário final", async () => {
    const { bot, store, messenger } = await drafted();
    await bot.handleUpdate(click("e:1"));
    await bot.handleUpdate(msg("Minha versão do comentário"));
    expect(store.posts[0]).toMatchObject({ status: "approved", final_comment: "Minha versão do comentário" });
    expect(messenger.last().html).toContain("<code>Minha versão do comentário</code>");
  });

  it("pular tira o post da fila", async () => {
    const { bot, store } = await drafted();
    await bot.handleUpdate(click("s:1"));
    expect(store.posts[0].status).toBe("skipped");
  });

  it("botões de outro chat são ignorados", async () => {
    const { bot, store } = await drafted();
    await bot.handleUpdate(click("a:1", 1000, 999));
    expect(store.posts[0].status).toBe("drafted");
  });
});

describe("/semana", () => {
  it("conta só as ações dos últimos 7 dias", async () => {
    const { bot, store, messenger } = await setup();
    await store.logAction("comment", 1, "2026-11-05T10:00:00Z");
    await store.logAction("comment", 2, "2026-10-01T10:00:00Z");
    await bot.handleUpdate(msg("/semana"));
    expect(messenger.last().html).toContain("Comentários: 1");
  });
});

describe("textos com HTML", () => {
  it("escapa o conteúdo do post e do comentário", async () => {
    const ctx = await setup();
    ctx.deps.drafter.draftComment = async () => "use <div> & seja feliz";
    await ctx.bot.handleUpdate(msg(`Post com <script> e & no meio, bem comprido.\n${URL}`));
    await ctx.bot.runDaily();
    const card = ctx.messenger.sent.find((s) => s.buttons)!;
    expect(card.html).toContain("&lt;script&gt;");
    expect(card.html).toContain("use &lt;div&gt; &amp; seja feliz");
  });
});

// ---------------- fase 3 ----------------

const REAL_URL = "https://www.linkedin.com/feed/update/urn:li:activity:7523368694966673408/";

describe("comentário publicado direto no LinkedIn", () => {
  async function draftedReal(over: Parameters<typeof makeDeps>[0] = {}) {
    const ctx = await setup(over);
    await ctx.bot.handleUpdate(msg(`${LONG_TEXT}\n${REAL_URL}`));
    await ctx.bot.runDaily();
    return ctx;
  }

  it("aprovar publica pelo LinkedIn, registra a ação e atualiza o cartão", async () => {
    const { bot, store, messenger, linkedin } = await draftedReal();
    expect(store.posts[0].urn).toBe("urn:li:activity:7523368694966673408");
    await bot.handleUpdate(click("a:1"));
    expect(linkedin.comments).toEqual([{ urn: "urn:li:activity:7523368694966673408", text: "Comentário 1" }]);
    expect(store.posts[0].status).toBe("commented");
    expect(store.actions).toMatchObject([{ type: "comment", refId: 1 }]);
    expect(messenger.edits.at(-1)?.html).toContain("publicado no LinkedIn");
  });

  it("aprovar duas vezes não publica duas vezes", async () => {
    const { bot, linkedin } = await draftedReal();
    await bot.handleUpdate(click("a:1"));
    await bot.handleUpdate(click("a:1"));
    expect(linkedin.comments).toHaveLength(1);
  });

  it("editar publica a versão do usuário", async () => {
    const { bot, linkedin, store } = await draftedReal();
    await bot.handleUpdate(click("e:1"));
    await bot.handleUpdate(msg("Minha versão"));
    expect(linkedin.comments[0].text).toBe("Minha versão");
    expect(store.posts[0]).toMatchObject({ status: "commented", final_comment: "Minha versão" });
  });

  it("se o LinkedIn recusar, cai no copiar e colar com o motivo", async () => {
    const ctx = await draftedReal();
    ctx.linkedin.failComment = new Error("HTTP 403");
    await ctx.bot.handleUpdate(click("a:1"));
    expect(ctx.store.posts[0].status).toBe("approved");
    expect(ctx.messenger.last().html).toContain("<code>Comentário 1</code>");
    expect(ctx.messenger.last().html).toContain("HTTP 403");
    expect(ctx.messenger.last().buttons?.[0][0].data).toBe("d:1");
  });

  it("sem LinkedIn conectado, pede /conectar e cai no copiar e colar", async () => {
    const ctx = await draftedReal();
    ctx.linkedin.conn = null;
    await ctx.bot.handleUpdate(click("a:1"));
    expect(ctx.linkedin.comments).toHaveLength(0);
    expect(ctx.messenger.last().html).toContain("/conectar");
  });

  it("'/agora' escrito junto com o link salva o post e gera as sugestões", async () => {
    const { bot, store, drafter } = await setup({ preview: { author: "Akram", text: LONG_TEXT } });
    await bot.handleUpdate(msg(`${REAL_URL}\n\n/agora`));
    expect(store.posts[0].text).toBe(LONG_TEXT);
    expect(drafter.calls).toHaveLength(1);
  });

  it("link curto lnkd.in usa o endereço final para achar o post", async () => {
    const { bot, store } = await setup({ preview: { author: null, text: null, url: REAL_URL } });
    await bot.handleUpdate(msg("https://lnkd.in/abc123"));
    expect(store.posts[0]).toMatchObject({ url: REAL_URL, urn: "urn:li:activity:7523368694966673408", status: "needs_text" });
  });
});

describe("/conectar", () => {
  it("manda o link de conexão e o status atual", async () => {
    const { bot, messenger } = await setup();
    await bot.handleUpdate(msg("/conectar"));
    expect(messenger.last().html).toContain("Conectado como <b>Matheus</b>");
    expect(messenger.last().html).toContain("linkedin.com/oauth/v2/authorization");
  });

  it("avisa quando as chaves do app não estão configuradas", async () => {
    const ctx = await setup();
    ctx.linkedin.configured = false;
    await ctx.bot.handleUpdate(msg("/conectar"));
    expect(ctx.messenger.last().html).toContain("não está configurado");
  });

  it("lembra de renovar quando faltam menos de 7 dias", async () => {
    const ctx = await setup();
    ctx.linkedin.conn = { name: "Matheus", expiresAt: "2026-11-10T00:00:00Z" };
    await ctx.bot.runDaily();
    expect(ctx.messenger.sent.some((s) => s.html.includes("vence em"))).toBe(true);
  });
});

describe("carrossel", () => {
  it("/carrossel <tema> gera, manda a prévia em imagens e os botões", async () => {
    const { bot, messenger, drafter, store } = await setup();
    await bot.handleUpdate(msg("/carrossel como escolher a stack"));
    expect(drafter.carouselCalls[0].topic).toBe("como escolher a stack");
    expect(messenger.photos).toHaveLength(1);
    const card = messenger.lastCard()!;
    expect(card.html).toContain("hoje (sexta) às 18h");
    expect(card.buttons?.[0][0].data).toBe("ca:1");
    expect(store.carousels[0].status).toBe("draft");
  });

  it("sem tema, pergunta e usa a próxima mensagem", async () => {
    const { bot, drafter } = await setup();
    await bot.handleUpdate(msg("/carrossel"));
    await bot.handleUpdate(msg("performance web"));
    expect(drafter.carouselCalls[0].topic).toBe("performance web");
  });

  it("aprovar agenda; aprovar outro substitui o anterior", async () => {
    const { bot, store, messenger } = await setup();
    await bot.handleUpdate(msg("/carrossel tema A"));
    await bot.handleUpdate(click("ca:1"));
    expect(store.carousels[0].status).toBe("approved");
    await bot.handleUpdate(msg("/carrossel tema B"));
    await bot.handleUpdate(click("ca:2"));
    expect(store.carousels.map((c) => c.status)).toEqual(["discarded", "approved"]);
    expect(messenger.edits.at(-1)?.html).toContain("substitui");
  });

  it("ajustar manda a versão atual e o pedido para o Claude", async () => {
    const { bot, drafter, store } = await setup();
    await bot.handleUpdate(msg("/carrossel tema A"));
    await bot.handleUpdate(click("cj:1"));
    await bot.handleUpdate(msg("slide 2 mais técnico"));
    expect(drafter.carouselCalls[1]).toMatchObject({ topic: "tema A", instructions: "slide 2 mais técnico" });
    expect(drafter.carouselCalls[1].previous?.titulo).toBe("Versão 1");
    expect(store.carousels.map((c) => c.status)).toEqual(["discarded", "draft"]);
  });

  it("refazer gera outra versão e descarta a anterior", async () => {
    const { bot, drafter, store } = await setup();
    await bot.handleUpdate(msg("/carrossel tema A"));
    await bot.handleUpdate(click("cr:1"));
    expect(drafter.carouselCalls[1].previous?.titulo).toBe("Versão 1");
    expect(drafter.carouselCalls[1].instructions).toBeUndefined();
    expect(store.carousels.map((c) => c.status)).toEqual(["discarded", "draft"]);
  });

  it("sexta publica o aprovado e registra a ação", async () => {
    const { bot, store, linkedin, messenger } = await setup();
    await bot.handleUpdate(msg("/carrossel tema A"));
    await bot.handleUpdate(click("ca:1"));
    await bot.publishCarousel();
    expect(linkedin.published).toEqual([{ title: "Versão 1", caption: "Legenda do post" }]);
    expect(store.carousels[0].status).toBe("published");
    expect(store.actions).toMatchObject([{ type: "post", refId: 1 }]);
    expect(messenger.last().html).toContain("Carrossel publicado");
  });

  it("se a publicação falhar, manda o PDF e a legenda para postar à mão", async () => {
    const ctx = await setup();
    await ctx.bot.handleUpdate(msg("/carrossel tema A"));
    await ctx.bot.handleUpdate(click("ca:1"));
    ctx.linkedin.failPublish = new Error("HTTP 403");
    await ctx.bot.publishCarousel();
    expect(ctx.store.carousels[0].status).toBe("failed");
    expect(ctx.messenger.documents[0].filename).toBe("carrossel.pdf");
    expect(ctx.messenger.last().html).toContain("Legenda do post");
  });

  it("um carrossel já aprovado não aceita refazer", async () => {
    const { bot, drafter, messenger } = await setup();
    await bot.handleUpdate(msg("/carrossel tema A"));
    await bot.handleUpdate(click("ca:1"));
    await bot.handleUpdate(click("cr:1"));
    expect(drafter.carouselCalls).toHaveLength(1);
    expect(messenger.answers.at(-1)?.text).toContain("já foi decidido");
  });
});

describe("agenda das 18h", () => {
  async function at(iso: string) {
    const ctx = makeDeps({ now: () => new Date(iso) });
    const bot = new Bot(ctx.deps, perfil);
    await bot.handleUpdate(msg("/start"));
    return { ...ctx, bot };
  }

  it("sexta publica o carrossel aprovado", async () => {
    const ctx = await at("2026-11-06T21:00:00Z");
    await ctx.bot.handleUpdate(msg("/carrossel tema A"));
    await ctx.bot.handleUpdate(click("ca:1"));
    await ctx.bot.runScheduled();
    expect(ctx.linkedin.published).toHaveLength(1);
  });

  it("quinta lembra do carrossel quando não há nenhum aprovado", async () => {
    const ctx = await at("2026-11-05T21:00:00Z");
    await ctx.bot.runScheduled();
    expect(ctx.messenger.sent.some((s) => s.html.includes("Amanhã às 18h"))).toBe(true);
    expect(ctx.linkedin.published).toHaveLength(0);
  });

  it("outros dias não mexem no carrossel", async () => {
    const ctx = await at("2026-11-04T21:00:00Z");
    await ctx.bot.handleUpdate(msg("/carrossel tema A"));
    await ctx.bot.handleUpdate(click("ca:1"));
    await ctx.bot.runScheduled();
    expect(ctx.linkedin.published).toHaveLength(0);
    expect(ctx.messenger.sent.some((s) => s.html.includes("Amanhã às 18h"))).toBe(false);
  });
});

describe("nextPublishLabel", () => {
  it("sexta antes das 18h é hoje; depois, a próxima sexta", () => {
    expect(nextPublishLabel(new Date("2026-11-06T20:59:00Z"))).toBe("hoje (sexta) às 18h");
    expect(nextPublishLabel(new Date("2026-11-06T21:00:00Z"))).toBe("sexta, 13/11, às 18h");
    expect(nextPublishLabel(new Date("2026-11-04T12:00:00Z"))).toBe("sexta, 06/11, às 18h");
  });
});

describe("idioma", () => {
  it("o cartão avisa quando a sugestão é em inglês", async () => {
    const { bot, messenger } = await setup();
    await bot.handleUpdate(msg(`This is what you need to know about the new release and how it will change your work.\n${URL}`));
    await bot.runDaily();
    expect(messenger.lastCard()!.html).toContain("em inglês");
  });
});
