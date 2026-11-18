import { describe, expect, it } from "vitest";
import { Bot, DEFAULT_BUDGET_USD, monthStartIso, parseBudget } from "../src/bot";
import { usageCost } from "../src/claude";
import { perfil } from "../src/perfil";
import { makeDeps, msg, OWNER } from "./fakes";

// Quarta, 18/11/2026, 10h em Brasília
const NOW = new Date("2026-11-18T13:00:00Z");

async function setup(over = {}) {
  const ctx = makeDeps({ now: () => NOW, ...over });
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  return { ...ctx, bot };
}

describe("custo de cada chamada", () => {
  it("soma tokens (inclusive cache) e buscas pelo preço do Sonnet 5.5", () => {
    const c = usageCost({
      input_tokens: 10_000,
      cache_read_input_tokens: 5_000,
      cache_creation_input_tokens: 0,
      output_tokens: 2_000,
      server_tool_use: { web_search_requests: 3 },
    } as never);
    // 15k × US$ 2/M + 2k × US$ 10/M + 3 × US$ 0,01
    expect(c).toMatchObject({ inputTokens: 15_000, outputTokens: 2_000, searches: 3, usd: 0.08 });
  });

  it("o mês começa no dia 1, 00h em Brasília", () => {
    expect(monthStartIso(NOW)).toBe("2026-11-01T03:00:00.000Z");
    expect(monthStartIso(new Date("2026-12-01T02:00:00Z"))).toBe("2026-11-01T03:00:00.000Z"); // ainda 30/11 em Brasília
  });

  it("entende o teto em dólares", () => {
    expect(parseBudget("teto 8")).toBe(8);
    expect(parseBudget("teto 7,5")).toBe(7.5);
    expect(parseBudget("teto 0")).toBeNull();
    expect(parseBudget("oito")).toBeNull();
  });
});

describe("/custos", () => {
  it("mostra semana, mês por tipo e o teto padrão", async () => {
    const { bot, store, messenger } = await setup();
    await store.addCost("vagas", 0.9, "2026-11-17T12:00:00Z"); // esta semana
    await store.addCost("vagas", 0.6, "2026-11-04T12:00:00Z"); // semana passada, mesmo mês
    await store.addCost("comentario", 0.02, "2026-11-18T10:00:00Z");
    await store.addCost("carrossel", 5, "2026-10-30T12:00:00Z"); // mês passado: fora
    await bot.handleUpdate(msg("/custos"));
    const html = messenger.last().html;
    expect(html).toContain("Esta semana: <b>US$ 0,92</b> (2 chamadas)");
    expect(html).toContain(`Este mês (novembro): <b>US$ 1,52</b> de US$ ${DEFAULT_BUDGET_USD},00`);
    expect(html).toContain("💼 Vagas: US$ 1,50 · 2 chamadas");
    expect(html).toContain("💬 Comentários: US$ 0,02 · 1 chamada");
    expect(html).not.toContain("Carrossel");
  });

  it("/custos teto 8 muda o teto", async () => {
    const { bot, store, messenger } = await setup();
    await bot.handleUpdate(msg("/custos teto 8"));
    expect(store.settings.get("budget_usd")).toBe("8");
    expect(messenger.last().html).toContain("de US$ 8,00");
    await bot.handleUpdate(msg("/custos teto abc"));
    expect(messenger.last().html).toContain("/custos teto 8");
  });
});

describe("teto mensal", () => {
  it("atingido: /vagas, /temas e carrossel param; post de imagem continua", async () => {
    const { bot, store, messenger, drafter } = await setup();
    await store.addCost("vagas", 5.1, "2026-11-10T12:00:00Z");
    for (const cmd of ["/vagas", "/temas", "/carrossel tema A"]) {
      await bot.handleUpdate(msg(cmd));
      expect(messenger.last().html).toContain("Teto do mês atingido:</b> US$ 5,10 de US$ 5,00");
    }
    expect(messenger.last().html).toContain("até 01/12");
    expect(drafter.jobCalls).toHaveLength(0);
    expect(drafter.topicCalls).toBe(0);
    expect(drafter.carouselCalls).toHaveLength(0);
    await bot.handleUpdate(msg("/post tema P"));
    expect(drafter.postCalls).toHaveLength(1);
  });

  it("as vagas automáticas de sábado também respeitam o teto", async () => {
    const { bot, store, messenger, drafter } = await setup();
    await store.addCost("vagas", 6, "2026-11-10T12:00:00Z");
    await bot.sendJobs(OWNER);
    expect(drafter.jobCalls).toHaveLength(0);
    expect(messenger.last().html).toContain("Teto do mês atingido");
  });

  it("aumentar o teto libera de novo", async () => {
    const { bot, store, drafter } = await setup();
    await store.addCost("vagas", 5.1, "2026-11-10T12:00:00Z");
    await bot.handleUpdate(msg("/custos teto 8"));
    await bot.handleUpdate(msg("/vagas"));
    expect(drafter.jobCalls).toHaveLength(1);
  });

  it("passou de 80%: avisa uma vez no mês", async () => {
    const { bot, store, messenger } = await setup();
    await store.addCost("carrossel", 4.2, "2026-11-10T12:00:00Z");
    await bot.handleUpdate(msg("/post tema P"));
    const warns = () => messenger.sent.filter((s) => s.html.includes("Gasto do mês com o Claude")).length;
    expect(warns()).toBe(1);
    expect(messenger.sent.find((s) => s.html.includes("Gasto do mês"))!.html).toContain("US$ 4,20 de US$ 5,00 (84%)");
    await bot.handleUpdate(msg("/post tema Q"));
    await bot.runDaily();
    expect(warns()).toBe(1);
  });

  it("abaixo de 80% não avisa", async () => {
    const { bot, store, messenger } = await setup();
    await store.addCost("carrossel", 1, "2026-11-10T12:00:00Z");
    await bot.handleUpdate(msg("/carrossel tema A"));
    expect(messenger.sent.some((s) => s.html.includes("Gasto do mês"))).toBe(false);
  });
});

describe("ClaudeDrafter anota o custo", () => {
  it("cada chamada vai para o medidor com o tipo certo, mesmo quando a resposta não serve", async () => {
    const { ClaudeDrafter } = await import("../src/claude");
    const seen: { kind: string; usd: number }[] = [];
    const drafter = new ClaudeDrafter("chave-falsa", perfil, async (kind, cost) => void seen.push({ kind, usd: cost.usd }));
    const reply = (text: string) => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: null },
    });
    let next = reply("Bom ponto sobre testes.");
    (drafter as unknown as { client: unknown }).client = { beta: { messages: { create: async () => next } } };

    await drafter.draftComment({ url: "https://x", author: "A", text: "post" }, []);
    next = reply("");
    await expect(drafter.sceneToPrompt("uma cena")).rejects.toThrow();
    expect(seen).toEqual([
      { kind: "comentario", usd: 0.003 },
      { kind: "cena", usd: 0.003 },
    ]);
  });
});
