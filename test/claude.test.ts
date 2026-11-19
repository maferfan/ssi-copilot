import { describe, expect, it } from "vitest";
import { costOf, searchedUrls, systemPrompt, urlKey } from "../src/claude";
import { perfil } from "../src/perfil";

describe("links conferidos", () => {
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
});

describe("custo", () => {
  it("pelo preço do Sonnet 5.5 e da busca", () => {
    // 30k entrada × $2/M + 6k saída × $10/M + 5 buscas × $0,01
    expect(costOf({ input: 30000, output: 6000, searches: 5 })).toEqual({ inputTokens: 30000, outputTokens: 6000, searches: 5, usd: 0.17 });
  });
});

describe("perfil dos comentários", () => {
  it("o resumo é de engenheiro full stack e proíbe falar de consultórios e clientes", () => {
    const p = systemPrompt(perfil);
    expect(p).toContain("Engenheiro de Software Full Stack");
    expect(p).not.toMatch(/sites rápidos|\(saúde, consultórios/);
    expect(p).toContain("Nunca falar de clientes, consultórios");
  });
});
