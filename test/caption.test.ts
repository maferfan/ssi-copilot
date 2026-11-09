import { describe, expect, it } from "vitest";
import { boldUnicode, buildCaption, CAPTION_LIMIT, type PostParts } from "../src/caption";
import { carouselSystemPrompt } from "../src/claude";
import { perfil } from "../src/perfil";

const parts = (over: Partial<PostParts> = {}): PostParts => ({
  titulo: "Your API is slow before it runs",
  gancho: "Only 42% of mobile sites have a good TTFB. The fix starts before your code.",
  pontos: ["Measure TTFB first", "Cache the query, not the page", "Move work out of the request"],
  conclusao: "Speed is a product decision, not a refactor.",
  pergunta: "What was the slowest endpoint you ever fixed?",
  hashtags: ["#webperformance", "backend", "AI engineering"],
  ...over,
});

describe("texto do post", () => {
  it("título em negrito Unicode; letras, números e pontuação", () => {
    expect(boldUnicode("TTFB 42%!")).toBe("𝗧𝗧𝗙𝗕 𝟰𝟮%!");
    expect(boldUnicode("ação")).toBe("𝗮çã𝗼"); // acentos ficam como estão
  });

  it("estrutura: título, gancho, pontos em lista, conclusão, pergunta, fontes e hashtags", () => {
    expect(buildCaption(parts())).toBe(
      [
        "𝗬𝗼𝘂𝗿 𝗔𝗣𝗜 𝗶𝘀 𝘀𝗹𝗼𝘄 𝗯𝗲𝗳𝗼𝗿𝗲 𝗶𝘁 𝗿𝘂𝗻𝘀",
        "Only 42% of mobile sites have a good TTFB. The fix starts before your code.",
        "→ Measure TTFB first\n→ Cache the query, not the page\n→ Move work out of the request",
        "Speed is a product decision, not a refactor.",
        "👉 What was the slowest endpoint you ever fixed?",
        "📊 Sources are cited under each chart.",
        "#webperformance #backend #AIengineering",
      ].join("\n\n"),
    );
  });

  it("tira os ** e espaços sobrando, e no máximo 3 hashtags", () => {
    const t = buildCaption(parts({ gancho: "  Only **42%**  of sites ", hashtags: ["a", "b", "c", "d"] }));
    expect(t).toContain("\n\nOnly 42% of sites\n\n");
    expect(t.endsWith("#a #b #c")).toBe(true);
  });

  it("respeita o limite de 3.000 caracteres do LinkedIn tirando pontos do fim", () => {
    const t = buildCaption(parts({ pontos: Array.from({ length: 5 }, () => "x".repeat(900)) }));
    expect(t.length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(t).toContain("👉 What was the slowest endpoint");
  });

  it("o pedido ao Claude descreve cada parte", () => {
    const sys = carouselSystemPrompt(perfil);
    expect(sys).toContain('"titulo": a strong headline, max 60 characters');
    expect(sys).toContain('"gancho": 1 to 2 short sentences, max 160 characters');
  });
});
