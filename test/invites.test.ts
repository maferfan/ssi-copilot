import { describe, expect, it } from "vitest";
import { Bot, parseInviteCount, WEEKLY_INVITE_GOAL } from "../src/bot";
import { dashboardHtml, loadDashboard } from "../src/dashboard";
import { perfil } from "../src/perfil";
import { makeDeps, msg } from "./fakes";

async function setup(now = "2026-11-06T14:00:00Z") {
  const ctx = makeDeps({ now: () => new Date(now) });
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  return { ...ctx, bot };
}

describe("parseInviteCount", () => {
  it.each([
    ["12", 12],
    ["+12", 12],
    ["-3", -3],
    [" 7 ", 7],
  ])("%j → %d", (text, n) => expect(parseInviteCount(text)).toBe(n));

  it("recusa o que não é um número", () => {
    expect(parseInviteCount("doze")).toBeNull();
    expect(parseInviteCount("10 convites")).toBeNull();
    expect(parseInviteCount("1234")).toBeNull();
  });
});

describe("/convites", () => {
  it(`soma na semana e mostra quantos faltam para ${WEEKLY_INVITE_GOAL}`, async () => {
    const { bot, messenger, store } = await setup();
    await bot.handleUpdate(msg("/convites 12"));
    expect(messenger.last().html).toContain("+12 registrados");
    expect(messenger.last().html).toContain("Convites: <b>12</b> de 50 (faltam <b>38</b>)");
    await bot.handleUpdate(msg("/convites 8"));
    expect(messenger.last().html).toContain("<b>20</b> de 50 (faltam <b>30</b>)");
    expect(store.actions.map((a) => [a.type, a.value])).toEqual([
      ["invite", 12],
      ["invite", 8],
    ]);
  });

  it("sem número mostra o total e aceita a próxima mensagem", async () => {
    const { bot, messenger } = await setup();
    await bot.handleUpdate(msg("/convites"));
    expect(messenger.last().html).toContain("<b>0</b> de 50 (faltam <b>50</b>)");
    await bot.handleUpdate(msg("dez"));
    expect(messenger.last().html).toContain("Não entendi");
    await bot.handleUpdate(msg("10"));
    expect(messenger.last().html).toContain("faltam <b>40</b>");
  });

  it("número negativo corrige, sem deixar o total abaixo de zero", async () => {
    const { bot, messenger } = await setup();
    await bot.handleUpdate(msg("/convites 5"));
    await bot.handleUpdate(msg("/convites -2"));
    expect(messenger.last().html).toContain("-2 corrigidos");
    expect(messenger.last().html).toContain("<b>3</b> de 50");
    await bot.handleUpdate(msg("/convites -9"));
    expect(messenger.last().html).toContain("não dá para tirar 9");
  });

  it("avisa quando bate a meta e quando passa do limite do LinkedIn", async () => {
    const { bot, messenger } = await setup();
    await bot.handleUpdate(msg("/convites 50"));
    expect(messenger.last().html).toContain("meta batida! 🎉");
    await bot.handleUpdate(msg("/convites 60"));
    expect(messenger.last().html).toContain("+60 🎉");
    expect(messenger.last().html).toContain("~100 por semana");
  });

  it("a semana nova começa do zero", async () => {
    const ctx = makeDeps({ now: () => now });
    let now = new Date("2026-11-08T20:00:00Z"); // domingo
    const bot = new Bot(ctx.deps, perfil);
    await bot.handleUpdate(msg("/start"));
    await bot.handleUpdate(msg("/convites 30"));
    now = new Date("2026-11-09T12:00:00Z"); // segunda
    await bot.handleUpdate(msg("/convites"));
    expect(ctx.messenger.last().html).toContain("<b>0</b> de 50");
  });

  it("entra no resumo da semana e no painel pela quantidade", async () => {
    const { bot, messenger, store } = await setup();
    await bot.handleUpdate(msg("/convites 15"));
    await bot.handleUpdate(msg("/semana"));
    expect(messenger.last().html).toContain("Convites: <b>15</b> de 50 (faltam <b>35</b>)");
    const data = await loadDashboard(store, new Date("2026-11-06T14:00:00Z"));
    expect(data.weeks.at(-1)?.invite).toBe(15);
    expect(dashboardHtml(data)).toContain("Convites enviados");
  });
});

describe("fila de trabalhos longos (webhook)", () => {
  it("no webhook, /carrossel vai para a fila e avisa; o cron roda depois", async () => {
    const ctx = makeDeps({ now: () => new Date("2026-11-08T11:00:00Z") });
    ctx.deps.defer = (job) => ctx.store.enqueueJob(job);
    const bot = new Bot(ctx.deps, perfil);
    await bot.handleUpdate(msg("/start"));
    await bot.handleUpdate(msg("/carrossel performance web"));
    expect(ctx.drafter.carouselCalls).toHaveLength(0);
    expect(ctx.store.jobs.map((j) => j.job.kind)).toEqual(["carousel"]);
    expect(ctx.messenger.last().html).toContain("a prévia chega em 1–2 minutos");

    const cron = new Bot({ ...ctx.deps, defer: undefined }, perfil);
    for (const { id, job } of await ctx.store.takeJobs(3)) {
      await cron.runJob(job);
      await ctx.store.finishJob(id, true);
    }
    expect(ctx.drafter.carouselCalls[0].topic).toBe("performance web");
  });

  it("um trabalho antigo de um tipo que não existe mais é ignorado sem erro", async () => {
    const { bot } = await setup();
    await expect(bot.runJob({ kind: "invites" } as never)).resolves.toBeUndefined();
  });

  it("falhas de trabalhos automáticos chegam no Telegram", async () => {
    const { bot, messenger } = await setup();
    await bot.reportFailure("Montar o carrossel", new Error("HTTP 529 <overloaded>"));
    expect(messenger.last().html).toContain("<b>Montar o carrossel</b> falhou: HTTP 529 &lt;overloaded&gt;");
  });
});
