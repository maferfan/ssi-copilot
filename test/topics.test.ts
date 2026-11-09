import { describe, expect, it } from "vitest";
import { Bot, topicButtons } from "../src/bot";
import { carouselHtml, HEIGHT, normalizeCarousel, WIDTH } from "../src/carousel";
import { topicsPrompt, verifyTopics } from "../src/claude";
import { perfil } from "../src/perfil";
import type { TopicIdea } from "../src/types";
import { click, makeDeps, msg, sampleCarousel } from "./fakes";

async function setup() {
  const ctx = makeDeps({ now: () => new Date("2026-11-09T14:00:00Z") });
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  return { ...ctx, bot };
}

const idea = (over: Partial<TopicIdea> = {}): TopicIdea => ({
  titulo: "React Compiler is stable",
  area: "frontend",
  gancho: "Do you still need useMemo?",
  porque: "Lançamento recente.",
  fonte: "React Blog",
  url: "https://react.dev/blog/2026/10/compiler",
  ...over,
});

describe("/temas", () => {
  it("lista os temas com área, gancho, motivo e fonte, e um botão por tema", async () => {
    const { bot, messenger, store } = await setup();
    await bot.handleUpdate(msg("/temas"));
    const card = messenger.lastCard()!;
    expect(card.html).toContain("Temas em alta");
    expect(card.html).toContain("<b>1. React Compiler is stable</b> · 🎨 Front-end");
    expect(card.html).toContain("<i>Do you still need useMemo?</i>");
    expect(card.html).toContain("2. Evals before prompts</b> · 🤖 IA");
    expect(card.html).toContain("não as métricas internas do LinkedIn");
    expect(card.buttons?.[0].map((b) => b.data)).toEqual(["tp:0", "tp:1"]);
    expect(JSON.parse((await store.getSetting("topics"))!)).toHaveLength(2);
  });

  it("tocar num tema monta o carrossel com o título e o gancho", async () => {
    const { bot, drafter } = await setup();
    await bot.handleUpdate(msg("/temas"));
    await bot.handleUpdate(click("tp:1"));
    expect(drafter.carouselCalls[0].topic).toBe("Evals before prompts — Your prompt is not the problem.");
  });

  it("lista expirada ou vazia avisa", async () => {
    const ctx = await setup();
    await ctx.bot.handleUpdate(click("tp:3"));
    expect(ctx.messenger.answers.at(-1)?.text).toContain("expirou");
    ctx.drafter.topicResults = [];
    await ctx.bot.handleUpdate(msg("/temas"));
    expect(ctx.messenger.last().html).toContain("Não achei temas");
  });

  it("no webhook, /temas vai para a fila", async () => {
    const ctx = await setup();
    ctx.deps.defer = (job) => ctx.store.enqueueJob(job);
    await ctx.bot.handleUpdate(msg("/temas"));
    expect(ctx.drafter.topicCalls).toBe(0);
    expect(ctx.store.jobs.map((j) => j.job.kind)).toEqual(["topics"]);
  });

  it("botões em linhas de 4", () => {
    expect(topicButtons(8).map((r) => r.length)).toEqual([4, 4]);
  });
});

describe("verifyTopics", () => {
  it("só temas com link conferido, sem repetidos, no máximo 8", () => {
    const seen = new Set(["react.dev/blog/2026/10/compiler", "infoq.com/a"]);
    const out = verifyTopics(
      [idea(), idea(), idea({ titulo: "Inventado", url: "https://inventado.example/x" }), idea({ titulo: "Evals", area: "ai", url: "https://www.infoq.com/a/" })],
      seen,
    );
    expect(out.map((t) => t.titulo)).toEqual(["React Compiler is stable", "Evals"]);
  });

  it("o pedido cobre as três áreas e pede o motivo em português", () => {
    const p = topicsPrompt(new Date("2026-11-09T00:00:00Z"));
    expect(p).toContain("Today is 2026-11-09");
    expect(p).toContain('"software" | "frontend" | "ai"');
    expect(p).toContain("in Brazilian Portuguese");
  });
});

describe("formato dos slides", () => {
  it("16:9, com texto e gráfico lado a lado", () => {
    expect([WIDTH, HEIGHT]).toEqual([1920, 1080]);
    const html = carouselHtml(
      normalizeCarousel({
        ...sampleCarousel(),
        capa_grafico: { tipo: "bar", titulo: "x", unidade: "%", dados: [{ label: "a", valor: 1 }, { label: "b", valor: 2 }], fonte: null, ilustrativo: true },
      }),
    );
    expect(html).toContain("@page { size: 1920px 1080px");
    expect(html).toContain('<div class="col-text">');
    expect(html).toContain('<div class="col-chart">');
  });
});
