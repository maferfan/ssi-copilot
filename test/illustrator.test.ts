import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot";
import { imagePostHtml } from "../src/imagepost";
import { FLUX_MODEL, FluxIllustrator, fluxPrompt } from "../src/illustrator";
import { perfil } from "../src/perfil";
import { click, makeDeps, msg, samplePost } from "./fakes";

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
  ctx.deps.drafter.draftImagePost = async (topic, previous, instructions) => {
    ctx.drafter.postCalls.push({ topic, previous, instructions });
    return { ...samplePost(`Versão ${ctx.drafter.postCalls.length}`), imagem_prompt: "a developer watching a slow loading bar" };
  };
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  return { ...ctx, bot, prompts };
}

describe("ilustração do post", () => {
  it("gera com a descrição do Claude, guarda no post e avisa no cartão", async () => {
    const { bot, store, messenger, prompts } = await setup();
    await bot.handleUpdate(msg("/post ttfb"));
    expect(prompts).toEqual(["a developer watching a slow loading bar"]);
    expect(store.drafts[0].content.capa_imagem).toBe(IMG);
    expect(messenger.lastCard()!.html).toContain("🖼️ Com ilustração gerada");
  });

  it("ajustar reaproveita a ilustração; refazer gera outra", async () => {
    const { bot, prompts } = await setup();
    await bot.handleUpdate(msg("/post ttfb"));
    await bot.handleUpdate(click("cj:1"));
    await bot.handleUpdate(msg("mais curto"));
    expect(prompts).toHaveLength(1);
    await bot.handleUpdate(click("cr:2"));
    expect(prompts).toHaveLength(2);
  });

  it("se a ilustração falhar, o post sai sem ela", async () => {
    const { bot, store, messenger } = await setup(null);
    await bot.handleUpdate(msg("/post ttfb"));
    expect(store.drafts[0].content.capa_imagem).toBeUndefined();
    expect(messenger.lastCard()!.html).not.toContain("ilustração gerada");
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

  it("erro do Workers AI vira null (não derruba o post)", async () => {
    const ai = { run: async () => { throw new Error("quota"); } } as unknown as Ai;
    expect(await new FluxIllustrator(ai).generate("a desk")).toBeNull();
  });
});

describe("arte com ilustração", () => {
  it("a ilustração entra no topo, num círculo", () => {
    const html = imagePostHtml({ ...samplePost(), capa_imagem: IMG });
    expect(html).toContain(`<img class="art" src="${IMG}"`);
  });

  it("descarta o que não for uma imagem embutida", () => {
    expect(imagePostHtml({ ...samplePost(), capa_imagem: "https://evil.example/x.jpg" })).not.toContain("evil.example");
  });
});

describe("🖼️ Outra imagem", () => {
  it("o cartão do post tem o botão", async () => {
    const { bot, messenger } = await setup();
    await bot.handleUpdate(msg("/post ttfb"));
    expect(messenger.lastCard()!.buttons?.at(-1)?.[0]).toEqual({ text: "🖼️ Outra imagem", data: "ci:1" });
  });

  it("mesma ideia: gera outra imagem com a mesma cena e mantém o texto", async () => {
    const { bot, store, prompts, drafter } = await setup();
    await bot.handleUpdate(msg("/post ttfb"));
    await bot.handleUpdate(click("ci:1"));
    await bot.handleUpdate(click("cn:1"));
    expect(prompts).toEqual(["a developer watching a slow loading bar", "a developer watching a slow loading bar"]);
    expect(drafter.postCalls).toHaveLength(1); // texto não foi reescrito
    expect(store.drafts.map((c) => c.status)).toEqual(["discarded", "draft"]);
    expect(store.drafts[1].content.titulo).toBe(store.drafts[0].content.titulo);
  });

  it("cena escrita pelo usuário: o Claude passa para inglês e o Flux usa essa cena", async () => {
    const { bot, store, prompts, drafter } = await setup();
    await bot.handleUpdate(msg("/post ttfb"));
    await bot.handleUpdate(click("ci:1"));
    await bot.handleUpdate(msg("uma pessoa olhando o relógio"));
    expect(drafter.sceneCalls).toEqual(["uma pessoa olhando o relógio"]);
    expect(prompts.at(-1)).toBe("EN: uma pessoa olhando o relógio");
    expect(store.drafts[1].content.imagem_prompt).toBe("EN: uma pessoa olhando o relógio");
  });

  it("post já aprovado não troca a imagem", async () => {
    const { bot, messenger, prompts } = await setup();
    await bot.handleUpdate(msg("/post ttfb"));
    await bot.handleUpdate(click("ca:1"));
    await bot.handleUpdate(click("ci:1"));
    expect(messenger.answers.at(-1)?.text).toContain("já foi decidido");
    expect(prompts).toHaveLength(1);
  });

  it("se o Flux falhar, avisa e o rascunho continua como estava", async () => {
    const ctx = await setup();
    await ctx.bot.handleUpdate(msg("/post ttfb"));
    ctx.deps.illustrator = { generate: async () => null };
    await ctx.bot.handleUpdate(click("ci:1"));
    await ctx.bot.handleUpdate(click("cn:1"));
    expect(ctx.messenger.last().html).toContain("Não consegui gerar a imagem");
    expect(ctx.store.drafts.map((c) => c.status)).toEqual(["draft"]);
  });
});
