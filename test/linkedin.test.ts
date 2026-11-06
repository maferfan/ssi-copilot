import { describe, expect, it } from "vitest";
import { decodeEntities, extractLinkedInUrl, parsePostHtml, textAroundUrl } from "../src/linkedin";
import { webhookSecret } from "../src/telegram";

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
