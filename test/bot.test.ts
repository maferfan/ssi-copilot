import { describe, expect, it } from "vitest";
import { Bot, DAILY_LIMIT } from "../src/bot";
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
