import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot";
import { recruiterSearchPrompt } from "../src/claude";
import { perfil } from "../src/perfil";
import { connectionNote, normalizeProfileUrl, parseJsonArray, selectCandidates } from "../src/recruiters";
import { click, fakeRecruiters, makeDeps, msg } from "./fakes";

describe("helpers", () => {
  it("normaliza o link do perfil", () => {
    expect(normalizeProfileUrl("https://br.linkedin.com/in/Ana-Souza-123/?trk=x")).toBe("https://www.linkedin.com/in/ana-souza-123");
    expect(normalizeProfileUrl("https://www.linkedin.com/company/acme")).toBeNull();
  });

  it("só português e inglês, sem repetidos e sem quem já foi sugerido", () => {
    const picked = selectCandidates(
      [
        { name: "Ana", headline: "", url: "https://www.linkedin.com/in/ana", language: "pt" },
        { name: "Ana de novo", headline: "", url: "https://br.linkedin.com/in/ana/", language: "pt" },
        { name: "Hans", headline: "", url: "https://www.linkedin.com/in/hans", language: "other" },
        { name: "Bob", headline: "", url: "https://www.linkedin.com/in/bob", language: "en" },
        { name: "Velha", headline: "", url: "https://www.linkedin.com/in/velha", language: "pt" },
        { name: "", headline: "", url: "https://www.linkedin.com/in/sem-nome", language: "pt" },
      ],
      ["https://www.linkedin.com/in/velha"],
      10,
    );
    expect(picked.map((p) => p.name)).toEqual(["Ana", "Bob"]);
  });

  it("nota de agradecimento no idioma do perfil, com até 200 caracteres", () => {
    const pt = connectionNote("Ana Souza", "pt");
    const en = connectionNote("John Smith", "en");
    expect(pt).toMatch(/^Olá, Ana!.*Obrigado desde já pela conexão!$/);
    expect(en).toMatch(/^Hi John,.*Thanks in advance for connecting!$/);
    expect(Math.max(pt.length, en.length)).toBeLessThanOrEqual(200);
  });

  it("lê o array JSON mesmo com texto em volta", () => {
    expect(parseJsonArray('Aqui está:\n[{"name":"Ana"}]\nPronto.')).toEqual([{ name: "Ana" }]);
    expect(parseJsonArray("sem json")).toEqual([]);
  });

  it("o pedido de busca lista quem não repetir", () => {
    const p = recruiterSearchPrompt(perfil, ["https://www.linkedin.com/in/ana"], 50);
    expect(p).toContain("https://www.linkedin.com/in/ana");
    expect(p).toContain('"other"');
  });
});

async function setup(now = "2026-11-08T11:00:00Z") {
  const ctx = makeDeps({ now: () => new Date(now) });
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  ctx.messenger.sent = [];
  return { ...ctx, bot };
}

describe("lista de domingo", () => {
  it("manda 50 perfis em 5 blocos de 10; só os 5 primeiros com nota", async () => {
    const { bot, store, messenger } = await setup();
    await bot.runInvites();
    expect(store.recruiters).toHaveLength(50);
    expect(store.recruiters.filter((r) => r.note)).toHaveLength(5);
    expect(store.recruiters[0].url).toBe("https://www.linkedin.com/in/pessoa-0");
    const blocks = messenger.sent.filter((s) => s.buttons);
    expect(blocks).toHaveLength(5);
    expect(blocks[0].html).toContain("Bloco 1/5");
    expect(blocks[0].html).toContain("Obrigado desde já");
    expect(blocks[4].html).toContain("50. ");
    expect(blocks[0].buttons?.[0][0].data).toBe("iv:2026-11-02:1");
    expect(messenger.sent.some((s) => s.html.includes("50 recrutadores para hoje</b> (25 🇧🇷 · 25 🌎)"))).toBe(true);
  });

  it("'Enviei' registra os convites do bloco uma única vez", async () => {
    const { bot, store, messenger } = await setup();
    await bot.runInvites();
    await bot.handleUpdate(click("iv:2026-11-02:2"));
    await bot.handleUpdate(click("iv:2026-11-02:2"));
    expect(store.actions.filter((a) => a.type === "invite")).toHaveLength(10);
    expect(store.recruiters.filter((r) => r.status === "invited").map((r) => r.batch)).toEqual(Array(10).fill(2));
    expect(messenger.edits.at(-1)?.html).toContain("10 convites registrados");
    expect(messenger.edits.at(-1)?.html).toContain("11. ");
    expect(messenger.answers.at(-1)?.text).toContain("já estava registrado");
  });

  it("na semana seguinte não repete ninguém", async () => {
    const ctx = await setup();
    await ctx.bot.runInvites();
    ctx.drafter.recruiterResults = [...fakeRecruiters(10), ...fakeRecruiters(5, 100)];
    await ctx.bot.runInvites();
    expect(ctx.drafter.recruiterCalls[1].exclude).toHaveLength(50);
    expect(ctx.store.recruiters).toHaveLength(55);
    // a segunda rodada na mesma semana continua a numeração dos blocos
    expect(ctx.store.recruiters.at(-1)?.batch).toBe(6);
  });

  it("/recrutadores roda na hora", async () => {
    const { bot, store } = await setup();
    await bot.handleUpdate(msg("/recrutadores"));
    expect(store.recruiters).toHaveLength(50);
  });

  it("avisa quando a busca falha ou não acha ninguém novo", async () => {
    const ctx = await setup();
    ctx.drafter.findRecruiters = async () => {
      throw new Error("rede");
    };
    await ctx.bot.runInvites();
    expect(ctx.messenger.last().html).toContain("Não consegui buscar");
    ctx.drafter.findRecruiters = async () => [];
    await ctx.bot.runInvites();
    expect(ctx.messenger.last().html).toContain("Não achei perfis novos");
  });

  it("os convites entram no resumo de domingo à noite", async () => {
    const { bot, messenger } = await setup();
    await bot.runInvites();
    await bot.handleUpdate(click("iv:2026-11-02:1"));
    await bot.handleUpdate(msg("/semana"));
    expect(messenger.last().html).toContain("Convites: <b>10</b>");
  });
});

describe("fila de trabalhos longos (webhook)", () => {
  it("no webhook, /recrutadores e /carrossel vão para a fila e avisam; o cron roda depois", async () => {
    const ctx = makeDeps({ now: () => new Date("2026-11-08T11:00:00Z") });
    ctx.deps.defer = (job) => ctx.store.enqueueJob(job);
    const bot = new Bot(ctx.deps, perfil);
    await bot.handleUpdate(msg("/start"));
    await bot.handleUpdate(msg("/recrutadores"));
    await bot.handleUpdate(msg("/carrossel performance web"));
    expect(ctx.store.recruiters).toHaveLength(0);
    expect(ctx.drafter.carouselCalls).toHaveLength(0);
    expect(ctx.store.jobs.map((j) => j.job.kind)).toEqual(["invites", "carousel"]);
    expect(ctx.messenger.last().html).toContain("a prévia chega em 1–2 minutos");

    // o cron de cada minuto roda sem defer
    const cron = new Bot({ ...ctx.deps, defer: undefined }, perfil);
    for (const { id, job } of await ctx.store.takeJobs(3)) {
      await cron.runJob(job);
      await ctx.store.finishJob(id, true);
    }
    expect(ctx.store.recruiters).toHaveLength(50);
    expect(ctx.drafter.carouselCalls[0].topic).toBe("performance web");
    expect(ctx.store.jobs.every((j) => j.status === "done")).toBe(true);
  });
});
