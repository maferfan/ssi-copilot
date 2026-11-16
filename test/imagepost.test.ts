import { describe, expect, it } from "vitest";
import { imagePostHtml, imagePostSystemPrompt, imagePostUserPrompt, IMAGE_POST_SCHEMA, normalizeImagePost } from "../src/imagepost";
import { perfil } from "../src/perfil";
import { samplePost } from "./fakes";

const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ titulo: `Step ${i + 1}`, texto: "Short text" }));

describe("normalizeImagePost", () => {
  it("passo a passo: de 3 a 6 passos, o resto é cortado", () => {
    const out = normalizeImagePost({ layout: "steps", passos: steps(8) });
    expect(out.layout).toBe("steps");
    expect(out.passos).toHaveLength(6);
    expect(out.ruim.itens).toEqual([]);
  });

  it("errado × certo: no máximo 4 itens por lado", () => {
    const out = normalizeImagePost({ layout: "compare", ruim: { titulo: "Avoid", itens: ["a", "b", "c", "d", "e"] }, bom: { titulo: "Do", itens: ["x", "y"] } });
    expect(out).toMatchObject({ layout: "compare", passos: [], ruim: { titulo: "Avoid" }, bom: { titulo: "Do", itens: ["x", "y"] } });
    expect(out.ruim.itens).toHaveLength(4);
  });

  it("se o modelo escolhido veio vazio, usa o outro; sem nenhum, dá erro", () => {
    expect(normalizeImagePost({ layout: "compare", passos: steps(3), ruim: { titulo: "", itens: [] }, bom: { titulo: "", itens: [] } }).layout).toBe("steps");
    expect(normalizeImagePost({ layout: "steps", passos: steps(1), ruim: { titulo: "", itens: ["a", "b"] }, bom: { titulo: "", itens: ["c", "d"] } })).toMatchObject({
      layout: "compare",
      ruim: { titulo: "Don't" },
      bom: { titulo: "Do" },
    });
    expect(() => normalizeImagePost({ layout: "steps", passos: steps(2) })).toThrow(/incompleto/);
  });

  it("corta textos longos demais para caber na arte", () => {
    const out = normalizeImagePost({ layout: "steps", passos: [{ titulo: "one two three four five six seven eight", texto: "w ".repeat(30) }, ...steps(2)] });
    expect(out.passos[0].titulo.split(" ")).toHaveLength(7);
    expect(out.passos[0].texto.split(" ")).toHaveLength(16);
  });
});

describe("arte do post", () => {
  it("passo a passo: título com destaque, passos numerados, sem ilustração quando não há", () => {
    const html = imagePostHtml(samplePost());
    expect(html).toContain('6 rules for <em class="hl">micro-interactions</em>');
    expect(html).toContain('<span class="num mono">01</span>');
    expect(html).toContain('<ol class="steps n3">');
    expect(html).toContain("3 steps");
    expect(html).not.toContain('class="art"');
  });

  it("errado × certo com ilustração; texto escapado", () => {
    const html = imagePostHtml({
      ...samplePost("<script>"),
      capa_imagem: "data:image/jpeg;base64,AAA",
      imagem: { layout: "compare", passos: [], ruim: { titulo: "Avoid", itens: ["a < b"] }, bom: { titulo: "Do", itens: ["ok"] } },
    });
    expect(html).toContain('<img class="art" src="data:image/jpeg;base64,AAA"');
    expect(html).toContain('<div class="col bad">');
    expect(html).toContain("<li>a &lt; b</li>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Don't vs Do");
  });
});

describe("pedido ao Claude", () => {
  it("explica os dois modelos, a imagem sem texto e o post nas duas línguas", () => {
    const p = imagePostSystemPrompt(perfil);
    expect(p).toContain('"steps"');
    expect(p).toContain('"compare"');
    expect(p).toContain("Never ask for text");
    expect(p).toContain('"post_pt"');
    expect(IMAGE_POST_SCHEMA.required).toContain("post_pt");
  });

  it("ajuste manda a versão atual; refazer pede outro ângulo", () => {
    expect(imagePostUserPrompt("ux", samplePost(), "use compare")).toContain("<ajuste>\nuse compare\n</ajuste>");
    expect(imagePostUserPrompt("ux", samplePost())).toContain("completely different version");
    expect(imagePostUserPrompt("ux", samplePost())).toContain('"layout": "steps"');
  });
});
