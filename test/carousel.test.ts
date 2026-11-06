import { describe, expect, it } from "vitest";
import { carouselHtml, fmtValue, normalizeCarousel } from "../src/carousel";
import {
  buildChart,
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
      slides: [
        { titulo: "JS everywhere", texto: "Most devs use it.", grafico: buildChart({ modo: "research", id_pesquisa: "R1", tipo: "bar", titulo: "Most used languages", unidade: "", dados: [] }, [item()]) },
        { titulo: "Effort", texto: "Small fixes first.", grafico: buildChart({ modo: "illustrative", id_pesquisa: "", tipo: "bar", titulo: "Effort vs impact", unidade: "", dados: [{ label: "Images", valor: 8 }, { label: "Fonts", valor: 5 }] }, []) },
        { titulo: "Plain", texto: "No chart here." },
      ],
    });

  it("cada gráfico mostra a fonte ou o selo de ilustrativo, e há um slide de referências", () => {
    const html = carouselHtml(withCharts());
    expect(html.match(/<figure class="chart">/g)).toHaveLength(2);
    expect(html).toContain("Source: Stack Overflow Developer Survey (2025) · survey.stackoverflow.co/2025/technology");
    expect(html).toContain("Illustrative data, not a measurement");
    expect(html).toContain('class="kicker mono">Sources</p>');
    expect(html).toContain("01 / 06"); // capa + 3 + referências + fechamento
    expect(html).toContain("Swipe →");
  });

  it("referências não se repetem", () => {
    const c = withCharts();
    c.slides[2].grafico = c.slides[0].grafico;
    expect(normalizeCarousel(c).referencias).toHaveLength(1);
  });

  it("carrossel antigo, sem gráficos, continua abrindo", () => {
    const html = carouselHtml(normalizeCarousel(sampleCarousel()));
    expect(html).not.toContain("<figure");
    expect(html).not.toContain(">Sources<");
  });
});

describe("prompts e custo", () => {
  it("escreve em inglês e exige gráfico em todo slide de conteúdo", () => {
    const sys = carouselSystemPrompt(perfil);
    expect(sys).toContain("always in English");
    expect(sys).toContain("Every content slide has a chart");
    expect(carouselUserPrompt("web perf", [])).toContain("use illustrative charts only");
    expect(carouselUserPrompt("web perf", [item()])).toContain('"id": "R1"');
  });

  it("custo pelo preço do Sonnet 5.5 e da busca", () => {
    // 30k entrada × $2/M + 6k saída × $10/M + 5 buscas × $0,01
    expect(costOf({ input: 30000, output: 6000, searches: 5 })).toEqual({ inputTokens: 30000, outputTokens: 6000, searches: 5, usd: 0.17 });
  });
});
