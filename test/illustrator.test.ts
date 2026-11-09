import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot";
import { carouselHtml, normalizeCarousel } from "../src/carousel";
import { FLUX_MODEL, FluxIllustrator, fluxPrompt } from "../src/illustrator";
import { perfil } from "../src/perfil";
import { click, makeDeps, msg, sampleCarousel } from "./fakes";

const IMG = "data:image/jpeg;base64,AAAA";

async function setup(art: string | null = IMG) {
  const ctx = makeDeps({ now: () => new Date("2026-11-09T14:00:00Z") });
  const prompts: string[] = [];
  ctx.deps.illustrator = {
    async generate(p) {
      prompts.push(p);
      return art;
    },
  };
  ctx.deps.drafter.draftCarousel = async (topic, previous, instructions) => {
    ctx.drafter.carouselCalls.push({ topic, previous, instructions });
    return { ...sampleCarousel(`Versão ${ctx.drafter.carouselCalls.length}`), imagem_prompt: "a developer watching a slow loading bar" };
  };
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  return { ...ctx, bot, prompts };
}

describe("ilustração da capa", () => {
  it("gera com a descrição do Claude, guarda no carrossel e avisa no cartão", async () => {
    const { bot, store, messenger, prompts } = await setup();
    await bot.handleUpdate(msg("/carrossel ttfb"));
    expect(prompts).toEqual(["a developer watching a slow loading bar"]);
    expect(store.carousels[0].content.capa_imagem).toBe(IMG);
    expect(messenger.lastCard()!.html).toContain("🖼️ Ilustração gerada na capa");
  });

  it("ajustar reaproveita a ilustração; refazer gera outra", async () => {
    const { bot, prompts } = await setup();
    await bot.handleUpdate(msg("/carrossel ttfb"));
    await bot.handleUpdate(click("cj:1"));
    await bot.handleUpdate(msg("mais curto"));
    expect(prompts).toHaveLength(1);
    await bot.handleUpdate(click("cr:2"));
    expect(prompts).toHaveLength(2);
  });

  it("se a ilustração falhar, o carrossel sai só com o gráfico", async () => {
    const { bot, store, messenger } = await setup(null);
    await bot.handleUpdate(msg("/carrossel ttfb"));
    expect(store.carousels[0].content.capa_imagem).toBeUndefined();
    expect(messenger.lastCard()!.html).not.toContain("Ilustração");
  });
});

describe("FluxIllustrator", () => {
  it("chama o Flux com o estilo fixo e devolve a imagem como data URL", async () => {
    const calls: unknown[] = [];
    const ai = { run: async (model: string, input: unknown) => (calls.push([model, input]), { image: "QUJD" }) } as unknown as Ai;
    expect(await new FluxIllustrator(ai).generate("a desk")).toBe("data:image/jpeg;base64,QUJD");
    expect(calls[0]).toEqual([FLUX_MODEL, { prompt: fluxPrompt("a desk"), steps: 8 }]);
    expect(fluxPrompt("a desk")).toMatch(/^a desk\. .*No text, no letters/);
  });

  it("erro do Workers AI vira null (não derruba o carrossel)", async () => {
    const ai = { run: async () => { throw new Error("quota"); } } as unknown as Ai;
    expect(await new FluxIllustrator(ai).generate("a desk")).toBeNull();
  });
});

describe("capa com ilustração", () => {
  it("a imagem ocupa a faixa direita; texto e gráfico ficam à esquerda", () => {
    const html = carouselHtml(
      normalizeCarousel({
        ...sampleCarousel(),
        capa_imagem: IMG,
        capa_grafico: { tipo: "bar", titulo: "x", unidade: "%", dados: [{ label: "a", valor: 1 }, { label: "b", valor: 2 }], fonte: null, ilustrativo: true },
      }),
    );
    expect(html).toContain('class="slide cover with-image"');
    expect(html).toContain(`<img class="cover-art" src="${IMG}"`);
    expect(html).toMatch(/with-image[\s\S]*<figure class="chart">/);
  });

  it("descarta o que não for uma imagem embutida", () => {
    expect(normalizeCarousel({ ...sampleCarousel(), capa_imagem: "https://evil.example/x.jpg" }).capa_imagem).toBeUndefined();
  });
});

describe("🖼️ Outra imagem", () => {
  it("o cartão do carrossel tem o botão", async () => {
    const { bot, messenger } = await setup();
    await bot.handleUpdate(msg("/carrossel ttfb"));
    expect(messenger.lastCard()!.buttons?.at(-1)?.[0]).toEqual({ text: "🖼️ Outra imagem", data: "ci:1" });
  });

  it("mesma ideia: gera outra imagem com a mesma cena e mantém o texto", async () => {
    const { bot, store, prompts, drafter } = await setup();
    await bot.handleUpdate(msg("/carrossel ttfb"));
    await bot.handleUpdate(click("ci:1"));
    await bot.handleUpdate(click("cn:1"));
    expect(prompts).toEqual(["a developer watching a slow loading bar", "a developer watching a slow loading bar"]);
    expect(drafter.carouselCalls).toHaveLength(1); // texto não foi reescrito
    expect(store.carousels.map((c) => c.status)).toEqual(["discarded", "draft"]);
    expect(store.carousels[1].content.titulo).toBe(store.carousels[0].content.titulo);
  });

  it("cena escrita pelo usuário: o Claude passa para inglês e o Flux usa essa cena", async () => {
    const { bot, store, prompts, drafter } = await setup();
    await bot.handleUpdate(msg("/carrossel ttfb"));
    await bot.handleUpdate(click("ci:1"));
    await bot.handleUpdate(msg("uma pessoa olhando o relógio"));
    expect(drafter.sceneCalls).toEqual(["uma pessoa olhando o relógio"]);
    expect(prompts.at(-1)).toBe("EN: uma pessoa olhando o relógio");
    expect(store.carousels[1].content.imagem_prompt).toBe("EN: uma pessoa olhando o relógio");
  });

  it("carrossel já aprovado não troca a imagem", async () => {
    const { bot, messenger, prompts } = await setup();
    await bot.handleUpdate(msg("/carrossel ttfb"));
    await bot.handleUpdate(click("ca:1"));
    await bot.handleUpdate(click("ci:1"));
    expect(messenger.answers.at(-1)?.text).toContain("já foi decidido");
    expect(prompts).toHaveLength(1);
  });

  it("se o Flux falhar, avisa e o rascunho continua como estava", async () => {
    const ctx = await setup();
    await ctx.bot.handleUpdate(msg("/carrossel ttfb"));
    ctx.deps.illustrator = { generate: async () => null };
    await ctx.bot.handleUpdate(click("ci:1"));
    await ctx.bot.handleUpdate(click("cn:1"));
    expect(ctx.messenger.last().html).toContain("Não consegui gerar a imagem");
    expect(ctx.store.carousels.map((c) => c.status)).toEqual(["draft"]);
  });
});
