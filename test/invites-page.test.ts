import { describe, expect, it } from "vitest";
import { hmacHex, safeEqual } from "../src/crypto";
import { invitesPageHtml } from "../src/invites-page";
import type { Recruiter } from "../src/types";

const row = (id: number, over: Partial<Recruiter> = {}): Recruiter => ({
  id,
  url: `https://www.linkedin.com/in/p${id}`,
  name: `Pessoa <${id}>`,
  headline: "Tech Recruiter",
  language: id % 2 ? "en" : "pt",
  note: id === 1 ? "Olá! Obrigado desde já pela conexão!" : null,
  week: "2026-11-02",
  batch: 1,
  status: "suggested",
  created_at: "2026-11-08T11:00:00Z",
  ...over,
});

describe("links assinados", () => {
  it("a assinatura muda com a chave e com o bloco", async () => {
    const a = await hmacHex("k1", "invites:2026-11-02:1");
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(await hmacHex("k2", "invites:2026-11-02:1")).not.toBe(a);
    expect(await hmacHex("k1", "invites:2026-11-02:2")).not.toBe(a);
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, a.replace(/.$/, "0"))).toBe(a.endsWith("0"));
  });
});

describe("página do bloco", () => {
  it("lista os perfis, escapa nomes, não vaza o link pelo Referer e manda o token no formulário", () => {
    const html = invitesPageHtml([row(1), row(2)], "2026-11-02", 1, "abc123");
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain("Pessoa &lt;1&gt;");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('name="t" value="abc123"');
    expect(html).toContain("Abrir os 2 em abas");
    expect(html).toContain("Copiar nota");
    expect(html).toContain("✔️ Enviei estes 2");
  });

  it("bloco já registrado não mostra o botão de enviar", () => {
    const html = invitesPageHtml([row(1, { status: "invited" })], "2026-11-02", 1, "x");
    expect(html).toContain("já foi registrado");
    expect(html).not.toContain("✔️ Enviei estes");
  });
});
