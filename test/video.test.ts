import { describe, expect, it } from "vitest";
import { Bot, videoReadCard, videoScenesCard } from "../src/bot";
import { urlKey } from "../src/claude";
import { perfil } from "../src/perfil";
import { countWords, finalizeScript, spokenText, verifyFacts, videoUserPrompt } from "../src/video";
import { click, makeDeps, msg, sampleScript } from "./fakes";

async function setup() {
  const ctx = makeDeps();
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  return { ...ctx, bot };
}

describe("roteiro", () => {
  it("conta palavras em português (hífen e apóstrofo contam como uma)", () => {
    expect(countWords("Você já parou de jogar no meio-termo? 1927, d'água.")).toBe(9);
  });

  it("só aceita fatos cujo site apareceu na busca", () => {
    const seen = new Set(["simplypsychology.org/zeigarnik-effect.html"]);
    const out = verifyFacts(
      [
        { id: "F1", fato: "Zeigarnik, 1927.", fonte: "Simply Psychology", ano: "1927", url: "https://www.simplypsychology.org/outra" },
        { id: "F2", fato: "Inventado.", fonte: "Blog", ano: "", url: "https://blog.exemplo.com/x" },
        { id: "F3", fato: "  ", fonte: "Simply Psychology", ano: "", url: "https://www.simplypsychology.org/zeigarnik-effect.html" },
      ],
      seen,
      urlKey,
    );
    expect(out.map((f) => f.id)).toEqual(["F1"]);
  });

  it("finaliza: limpa fatos não citados, corta destaque e calcula a duração", () => {
    const s = sampleScript();
    const out = finalizeScript(
      { ...s, trechos: [...s.trechos.slice(0, 2), { fala: "Jogos usam isso.", imagem: "x", destaque: "um dois três quatro", fato_id: "F9" }] },
      [...s.fatos, { id: "F2", fato: "Não usado.", fonte: "x", ano: "", url: "https://x.org" }],
    );
    expect(out.trechos[2]).toMatchObject({ destaque: "um dois três", fato_id: "" });
    expect(out.fatos.map((f) => f.id)).toEqual(["F1"]);
    expect(out.palavras).toBe(countWords(spokenText(out)));
    expect(out.segundos).toBe(Math.round(out.palavras / 2.7));
  });

  it("recusa roteiro sem título ou com poucos trechos", () => {
    expect(() => finalizeScript({ ...sampleScript(), trechos: sampleScript().trechos.slice(0, 2) }, [])).toThrow(/incompleto/);
  });

  it("sem fatos conferidos, pede para não citar estudos", () => {
    expect(videoUserPrompt("zeigarnik", [])).toMatch(/do not cite any study/);
  });
});

describe("/video", () => {
  it("manda o texto para gravar e o cartão com cenas, fontes e botões", async () => {
    const { bot, messenger, drafter, store } = await setup();
    await bot.handleUpdate(msg("/video missões pela metade"));
    expect(drafter.videoCalls[0].topic).toBe("missões pela metade");
    expect(store.videos).toHaveLength(1);
    const [read, card] = messenger.sent.slice(-2);
    expect(read.html).toContain("Abertura");
    expect(read.html).toContain("efeito Zeigarnik");
    expect(card.html).toContain("Cenas");
    expect(card.html).toContain("simplypsychology.org");
    expect(card.html).toContain("Como gravar");
    expect(card.buttons?.flat().map((b) => b.data)).toEqual(["vr:1", "vj:1", "vx:1"]);
  });

  it("sem tema, pergunta e usa a próxima mensagem", async () => {
    const { bot, messenger, drafter } = await setup();
    await bot.handleUpdate(msg("/video"));
    expect(messenger.last().html).toContain("Qual o tema do vídeo?");
    await bot.handleUpdate(msg("loot boxes"));
    expect(drafter.videoCalls[0].topic).toBe("loot boxes");
  });

  it("ajustar reaproveita o roteiro anterior e descarta o rascunho", async () => {
    const { bot, drafter, store } = await setup();
    await bot.handleUpdate(msg("/video zeigarnik"));
    await bot.handleUpdate(click("vj:1"));
    await bot.handleUpdate(msg("use Dark Souls como exemplo"));
    expect(drafter.videoCalls[1]).toMatchObject({ topic: "zeigarnik", instructions: "use Dark Souls como exemplo" });
    expect(drafter.videoCalls[1].previous?.titulo).toBe("Versão 1");
    expect(store.videos.map((v) => v.status)).toEqual(["discarded", "draft"]);
  });

  it("refazer pede versão nova; descartado não aceita mais botões", async () => {
    const { bot, drafter, store, messenger } = await setup();
    await bot.handleUpdate(msg("/video zeigarnik"));
    await bot.handleUpdate(click("vr:1"));
    expect(drafter.videoCalls[1]).toMatchObject({ topic: "zeigarnik", instructions: undefined });
    await bot.handleUpdate(click("vx:2"));
    expect(store.videos[1].status).toBe("discarded");
    await bot.handleUpdate(click("vr:2"));
    expect(messenger.answers.at(-1)?.text).toBe("Esse roteiro já foi decidido.");
  });

  it("escapa HTML do roteiro", () => {
    const v = { id: 1, topic: "x", status: "draft" as const, created_at: "", script: { ...sampleScript("<b>oi</b>"), legenda: "a & b" } };
    expect(videoReadCard(v)).toContain("&lt;b&gt;oi&lt;/b&gt;");
    expect(videoScenesCard(v)).toContain("a &amp; b");
  });
});
