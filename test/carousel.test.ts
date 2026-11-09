import { describe, expect, it } from "vitest";
import { carouselHtml, fmtValue, normalizeCarousel, wrapLabel } from "../src/carousel";
import {
  buildChart,
  ensureCoverChart,
  carouselSystemPrompt,
  carouselUserPrompt,
  costOf,
  researchFromCarousel,
  searchedUrls,
  urlKey,
  verifyResearch,
  type ResearchItem,
} from "../src/claude";
import { perfil } from "../src/perfil";
import { sampleCarousel } from "./fakes";

const item = (over: Partial<ResearchItem> = {}): ResearchItem => ({
  id: "R1",
  fonte: "Stack Overflow Developer Survey",
  ano: "2025",
  url: "https://survey.stackoverflow.co/2025/technology/",
  achado: "JavaScript is the most used language",
  tipo: "bar",
  unidade: "%",
  dados: [
    { label: "JavaScript", valor: 66 },
    { label: "Python", valor: 57.9 },
  ],
  ...over,
});

describe("referências conferidas", () => {
  it("compara links sem www, barra final, parâmetros e âncora", () => {
    expect(urlKey("https://www.Survey.stackoverflow.co/2025/technology/?utm=x#top")).toBe("survey.stackoverflow.co/2025/technology");
    expect(urlKey("não é link")).toBeNull();
  });

  it("só conta links dos resultados da busca e das citações, nunca do texto do modelo", () => {
    const content = [
      { type: "server_tool_use", input: { query: "js usage" } },
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://survey.stackoverflow.co/2025/technology/" }] },
      { type: "text", text: "Veja https://inventado.example/estudo", citations: [{ url: "https://almanac.httparchive.org/en/2024/performance" }] },
    ];
    const seen = searchedUrls(content);
    expect(seen.has("survey.stackoverflow.co/2025/technology")).toBe(true);
    expect(seen.has("almanac.httparchive.org/en/2024/performance")).toBe(true);
    expect(seen.has("inventado.example/estudo")).toBe(false);
  });

  it("descarta dado com link que não apareceu na busca ou sem números suficientes", () => {
    const seen = new Set(["survey.stackoverflow.co/2025/technology"]);
    const kept = verifyResearch(
      [item(), item({ id: "R2", url: "https://inventado.example/estudo" }), item({ id: "R3", dados: [{ label: "x", valor: 1 }] })],
      seen,
    );
    expect(kept.map((k) => k.id)).toEqual(["R1"]);
  });
});

describe("gráficos", () => {
  it("modo pesquisa: os números vêm da pesquisa, não do que o modelo escreveu", () => {
    const g = buildChart(
      { modo: "research", id_pesquisa: "R1", tipo: "line", titulo: "Most used", unidade: "", dados: [{ label: "JavaScript", valor: 99 }] },
      [item()],
    )!;
    expect(g.dados).toEqual(item().dados);
    expect(g).toMatchObject({ tipo: "bar", unidade: "%", ilustrativo: false, fonte: { nome: "Stack Overflow Developer Survey", ano: "2025" } });
  });

  it("id de pesquisa que não existe vira ilustrativo, sem fonte", () => {
    const g = buildChart(
      { modo: "research", id_pesquisa: "R9", tipo: "bar", titulo: "Effort vs impact", unidade: "", dados: [{ label: "A", valor: 3 }, { label: "B", valor: 8 }] },
      [item()],
    )!;
    expect(g).toMatchObject({ ilustrativo: true, fonte: null });
  });

  it('modo "none" deixa o slide só com texto', () => {
    expect(buildChart({ modo: "none", id_pesquisa: "", tipo: "bar", titulo: "", unidade: "", dados: [] }, [item()])).toBeUndefined();
  });

  it("a capa sempre tem gráfico: sem um, sobe o primeiro gráfico dos slides", () => {
    const g = buildChart({ modo: "research", id_pesquisa: "R1", tipo: "bar", titulo: "", unidade: "", dados: [] }, [item()]);
    const r = ensureCoverChart(undefined, [{ titulo: "A", texto: "" }, { titulo: "B", texto: "", grafico: g }], [item()]);
    expect(r.cover?.fonte?.nome).toBe("Stack Overflow Developer Survey");
    expect(r.slides[1].grafico).toBeUndefined();
  });

  it("a capa sempre tem gráfico: sem nenhum nos slides, usa o primeiro dado conferido", () => {
    const r = ensureCoverChart(undefined, [{ titulo: "A", texto: "" }], [item()]);
    expect(r.cover?.dados).toEqual(item().dados);
  });

  it("no máximo 3 gráficos por carrossel, contando o da capa", () => {
    const g = buildChart({ modo: "research", id_pesquisa: "R1", tipo: "bar", titulo: "", unidade: "", dados: [] }, [item()]);
    const c = normalizeCarousel({ ...sampleCarousel(), capa_grafico: g, slides: Array.from({ length: 3 }, (_, i) => ({ titulo: `S${i}`, texto: "", grafico: g })) });
    expect(c.slides.filter((x) => x.grafico)).toHaveLength(2);
  });

  it("ajuste reaproveita as fontes já conferidas sem nova busca", () => {
    const c = normalizeCarousel({
      ...sampleCarousel(),
      slides: [
        { titulo: "A", texto: "", grafico: buildChart({ modo: "research", id_pesquisa: "R1", tipo: "bar", titulo: "", unidade: "", dados: [] }, [item()]) },
        { titulo: "B", texto: "" },
        { titulo: "C", texto: "" },
      ],
    });
    expect(researchFromCarousel(c)).toMatchObject([{ fonte: "Stack Overflow Developer Survey", url: item().url, dados: item().dados }]);
  });

  it("formata valores com a unidade", () => {
    expect(fmtValue(57.94, "%")).toBe("57.9%");
    expect(fmtValue(1200, "ms")).toBe("1,200 ms");
    expect(fmtValue(3, "points")).toBe("3 points");
  });
});

describe("slides", () => {
  const withCharts = () =>
    normalizeCarousel({
      ...sampleCarousel("Is your site **slow**?"),
      capa_grafico: buildChart({ modo: "research", id_pesquisa: "R1", tipo: "bar", titulo: "Most used languages", unidade: "", dados: [] }, [item()]),
      slides: [
        { titulo: "Effort", texto: "Small fixes first.", grafico: buildChart({ modo: "illustrative", id_pesquisa: "", tipo: "bar", titulo: "Effort vs impact", unidade: "", dados: [{ label: "Images", valor: 8 }, { label: "Fonts", valor: 5 }] }, []) },
      ],
    });

  it("capa com gráfico; a fonte (ou o selo de ilustrativo) fica embaixo de cada gráfico, sem lista no fim", () => {
    const html = carouselHtml(withCharts());
    expect(html).toContain('class="slide cover with-chart"');
    expect(html.match(/<figure class="chart">/g)).toHaveLength(2);
    expect(html).toContain("Source: Stack Overflow Developer Survey (2025) · survey.stackoverflow.co/2025/technology");
    expect(html).toContain("Illustrative data, not a measurement");
    expect(html).toContain('class="slide closing"');
    expect(html).not.toContain(">Sources<");
    expect(html.match(/<section class="slide/g)).toHaveLength(3); // capa + 1 + fechamento
    expect(html).toContain("01 / 03");
  });

  it("referências não se repetem", () => {
    const c = withCharts();
    c.slides[0].grafico = c.capa_grafico;
    expect(normalizeCarousel(c).referencias).toHaveLength(1);
  });

  it("carrossel antigo, sem gráficos, continua abrindo", () => {
    const html = carouselHtml(normalizeCarousel(sampleCarousel()));
    expect(html).not.toContain("<figure");
    expect(html).not.toContain(">Sources<");
  });
});

describe("prompts e custo", () => {
  it("escreve em inglês, com 3 a 5 slides e gráfico sempre na capa", () => {
    const sys = carouselSystemPrompt(perfil);
    expect(sys).toContain("always in English");
    expect(sys).toContain("3 to 5 slides in total");
    expect(sys).toContain("The cover (slide 1) ALWAYS has a chart");
    expect(carouselUserPrompt("web perf", [])).toContain("use illustrative charts only");
    expect(carouselUserPrompt("web perf", [item()])).toContain('"id": "R1"');
  });

  it("custo pelo preço do Sonnet 5.5 e da busca", () => {
    // 30k entrada × $2/M + 6k saída × $10/M + 5 buscas × $0,01
    expect(costOf({ input: 30000, output: 6000, searches: 5 })).toEqual({ inputTokens: 30000, outputTokens: 6000, searches: 5, usd: 0.17 });
  });
});

describe("rótulos das barras", () => {
  it("quebram em até 2 linhas por palavra; o excesso vira …", () => {
    expect(wrapLabel("Use AI tools in workflows")).toEqual(["Use AI tools in workflows"]);
    expect(wrapLabel("Spend more time fixing almost-right AI code")).toEqual(["Spend more time fixing", "almost-right AI code"]);
    expect(wrapLabel("Would still ask a person when they don't trust AI answers")).toEqual(["Would still ask a person", "when they don't trust AI…"]);
  });

  it("rótulo longo não é cortado antes de chegar ao gráfico", () => {
    const c = normalizeCarousel({
      ...sampleCarousel(),
      slides: [{ titulo: "a", texto: "", grafico: { tipo: "bar", titulo: "", unidade: "%", dados: [{ label: "Spend more time fixing almost-right AI code", valor: 66 }, { label: "Trust", valor: 29 }], fonte: null, ilustrativo: true } }],
    });
    const html = carouselHtml(c);
    expect(html).toContain(">Spend more time fixing</tspan>");
    expect(html).toContain(">almost-right AI code</tspan>");
  });
});
