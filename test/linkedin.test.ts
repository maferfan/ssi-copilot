import { describe, expect, it, vi } from "vitest";
import { decodeEntities, extractLinkedInUrl, fetchPreview, isBoilerplate, isLoginWall, parsePostHtml, textAroundUrl, unwrapLinkedInUrl } from "../src/linkedin";
import { webhookSecret } from "../src/telegram";
import { detectLanguage } from "../src/language";
import { userPrompt } from "../src/claude";

describe("extractLinkedInUrl", () => {
  it("acha o link no meio do texto e tira a pontuação final", () => {
    expect(extractLinkedInUrl("olha esse: https://www.linkedin.com/posts/fulana_abc-123-xyz).")).toBe(
      "https://www.linkedin.com/posts/fulana_abc-123-xyz",
    );
  });

  it("aceita links curtos lnkd.in e links vindos de entidades", () => {
    expect(extractLinkedInUrl("veja", ["https://lnkd.in/dAbC123"])).toBe("https://lnkd.in/dAbC123");
  });

  it("ignora outros sites", () => {
    expect(extractLinkedInUrl("https://example.com/linkedin.com")).toBeNull();
  });

  it("separa o texto colado do link", () => {
    const url = "https://www.linkedin.com/feed/update/urn:li:activity:1/";
    expect(textAroundUrl(`Texto do post\n\n${url}`, url)).toBe("Texto do post");
  });
});

describe("parsePostHtml", () => {
  it("prefere o JSON-LD, que traz o texto inteiro", () => {
    const html = `<html><head>
      <meta property="og:title" content="Resumo | Fulana Souza | 12 comentários">
      <meta property="og:description" content="Resumo cortado...">
      <script type="application/ld+json">{"@type":"SocialMediaPosting","articleBody":"Texto completo do post sobre entrevistas técnicas.","author":{"name":"Fulana Souza"}}</script>
    </head></html>`;
    expect(parsePostHtml(html)).toEqual({ author: "Fulana Souza", text: "Texto completo do post sobre entrevistas técnicas." });
  });

  it("usa Open Graph quando não há JSON-LD", () => {
    const html = `<meta property="og:title" content="Beltrano Lima on LinkedIn: Os 5 erros &amp; acertos">
      <meta content="Os 5 erros mais comuns em entrevistas t&#233;cnicas" property="og:description">`;
    expect(parsePostHtml(html)).toEqual({ author: "Beltrano Lima", text: "Os 5 erros mais comuns em entrevistas técnicas" });
  });

  it("decodifica entidades HTML", () => {
    expect(decodeEntities("a &lt;b&gt; &quot;c&quot; &#x1F600;")).toBe('a <b> "c" 😀');
  });
});

describe("webhookSecret", () => {
  it("bate com o cálculo feito no workflow de deploy (sha256sum | cut -c1-48)", async () => {
    const token = "123:ABC";
    // printf '%s' "ssi-copilot:123:ABC" | sha256sum | cut -c1-48
    const expected = "02110598d0e7f19c66fbcb4881e87277f1fb6e0960581b7f";
    expect(await webhookSecret(token)).toBe(expected);
  });
});

describe("detectLanguage", () => {
  it.each([
    ["Most developers ignore this when they build a design system, and it costs them later.", "en"],
    ["A maioria dos devs ignora isso quando monta um design system, e depois paga caro.", "pt"],
    ["Feature-Sliced Design: como organizar um projeto React que não vira bagunça", "pt"],
    ["Why your Next.js app is slow: 5 things to check before you blame the framework", "en"],
  ])("%s → %s", (text, lang) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it("sem texto assume português", () => {
    expect(detectLanguage(null)).toBe("pt");
  });
});

describe("userPrompt", () => {
  it("pede o comentário no idioma do post", () => {
    const en = userPrompt({ url: "u", author: "A", text: "This is what you need to know about the new release." }, []);
    const pt = userPrompt({ url: "u", author: "A", text: "Isso é o que você precisa saber sobre a nova versão." }, []);
    expect(en).toContain("escreva o comentário em inglês");
    expect(pt).toContain("português do Brasil");
  });
});

describe("tela de login do LinkedIn", () => {
  const SIGNUP =
    "https://www.linkedin.com/signup/cold-join?session_redirect=https%3A%2F%2Fwww%2Elinkedin%2Ecom%2Ffeed%2Fupdate%2Furn%3Ali%3Ashare%3A7515950088356208640%3Futm_source%3Dshare%26utm_medium%3Dmember_desktop%26rcm%3DACoAAC7c7GkB3NExOcOU7p74ekGblJJuNqLhxdQ";

  it("reconhece páginas de login e cadastro", () => {
    expect(isLoginWall(SIGNUP)).toBe(true);
    expect(isLoginWall("https://www.linkedin.com/authwall?trk=x")).toBe(true);
    expect(isLoginWall("https://www.linkedin.com/feed/update/urn:li:share:1/")).toBe(false);
  });

  it("tira o post de dentro do link de cadastro (o link do print)", () => {
    const url = unwrapLinkedInUrl(SIGNUP);
    expect(url).toMatch(/^https:\/\/www\.linkedin\.com\/feed\/update\/urn:li:share:7515950088356208640/);
    expect(extractLinkedInUrl(`olha ${SIGNUP}`)).toBe(url);
  });

  it("reconhece o texto padrão do LinkedIn, em português e inglês", () => {
    expect(isBoilerplate("Mais de 950 milhões de usuários | Gerencie sua identidade profissional.")).toBe(true);
    expect(isBoilerplate("LinkedIn: Log In or Sign Up")).toBe(true);
    expect(isBoilerplate("500 million members | Manage your professional identity")).toBe(true);
    expect(isBoilerplate("Os 5 erros mais comuns em entrevistas técnicas e como evitar.")).toBe(false);
  });

  it("fetchPreview: se cair no login, não devolve o texto da página e mantém o link do post", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, url: SIGNUP, text: async () => '<meta property="og:description" content="Mais de 950 milhões de usuários | Gerencie sua identidade profissional">' }));
    try {
      const p = await fetchPreview("https://www.linkedin.com/feed/update/urn:li:share:7515950088356208640/");
      expect(p?.text).toBeNull();
      expect(p?.url).toContain("/feed/update/urn:li:share:7515950088356208640");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
