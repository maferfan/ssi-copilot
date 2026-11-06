import { describe, expect, it } from "vitest";
import { barChart, dashboardHtml, lineChart, loadDashboard, niceMax } from "../src/dashboard";
import { lastWeeks, weekKey } from "../src/week";
import { MemoryStore, sampleCarousel } from "./fakes";

const NOW = new Date("2026-11-06T14:00:00Z"); // sexta, semana de 02/11

describe("semanas", () => {
  it("segunda a domingo no horário de Brasília", () => {
    expect(weekKey(new Date("2026-11-02T03:00:00Z"))).toBe("2026-11-02"); // segunda 00:00 BRT
    expect(weekKey(new Date("2026-11-02T02:59:00Z"))).toBe("2026-10-26"); // domingo 23:59 BRT
    expect(weekKey(new Date("2026-11-08T21:00:00Z"))).toBe("2026-11-02"); // domingo 18h
  });

  it("lastWeeks termina na semana atual", () => {
    const w = lastWeeks(NOW, 3);
    expect(w).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
  });
});

describe("loadDashboard", () => {
  it("agrupa ações e números por semana", async () => {
    const store = new MemoryStore();
    await store.logAction("comment", 1, "2026-11-03T10:00:00Z");
    await store.logAction("comment", 2, "2026-11-04T10:00:00Z");
    await store.logAction("post", 1, "2026-10-30T21:00:00Z");
    await store.saveMetrics({ week: "2026-11-02", profile_views: 120, impressions: 3400, followers: 215 });
    const data = await loadDashboard(store, NOW);
    expect(data.weeks).toHaveLength(12);
    expect(data.weeks.at(-1)).toMatchObject({ week: "2026-11-02", comment: 2, post: 0, metrics: { profile_views: 120 } });
    expect(data.weeks.at(-2)).toMatchObject({ week: "2026-10-26", post: 1 });
  });
});

describe("gráficos", () => {
  it("niceMax arredonda para 1, 2 ou 5 × 10^n", () => {
    expect([0, 3, 7, 12, 180, 4300].map(niceMax)).toEqual([1, 5, 10, 20, 200, 5000]);
  });

  it("barras: uma coluna com dica por semana, sem barra quando é zero", () => {
    const svg = barChart("t", ["2026-10-26", "2026-11-02"], [0, 3], ["comentário", "comentários"]);
    expect(svg.match(/class="col"/g)).toHaveLength(2);
    expect(svg.match(/class="mark"/g)).toHaveLength(1);
    expect(svg).toContain("Semana de 02/11: 3 comentários");
  });

  it("linha: lacuna nas semanas sem número e rótulo no último valor", () => {
    const svg = lineChart("t", ["2026-10-19", "2026-10-26", "2026-11-02"], [100, null, 1200], "visualizações");
    const d = svg.match(/class="line" d="([^"]+)"/)![1];
    expect(d.match(/M/g)).toHaveLength(2);
    expect(svg).toContain(">1.200</text>");
    expect(svg).toContain("Semana de 26/10: sem número");
  });

  it("linha sem nenhum número mostra como registrar", () => {
    expect(lineChart("t", ["2026-11-02"], [null], "x")).toContain("/metricas");
  });
});

describe("página", () => {
  it("mostra os números da semana, os carrosséis e a tabela", async () => {
    const store = new MemoryStore();
    await store.logAction("comment", 1, "2026-11-03T10:00:00Z");
    await store.saveMetrics({ week: "2026-10-26", profile_views: 100, impressions: 3000, followers: 200 });
    await store.saveMetrics({ week: "2026-11-02", profile_views: 120, impressions: 3400, followers: 215 });
    const id = await store.addCarousel({ topic: "x", content: sampleCarousel("Seu site é **lento**?"), createdAt: "2026-10-30T12:00:00Z" });
    await store.updateCarousel(id, { status: "published", published_at: "2026-10-30T21:00:00Z", post_url: "https://www.linkedin.com/feed/update/urn:li:share:9/" });

    const html = dashboardHtml(await loadDashboard(store, NOW));
    expect(html).toContain("+20 vs. semana anterior");
    expect(html).toContain('href="https://www.linkedin.com/feed/update/urn:li:share:9/"');
    expect(html).toContain("Seu site é lento?");
    expect(html.match(/<tr>/g)).toHaveLength(13); // cabeçalho + 12 semanas
  });
});
