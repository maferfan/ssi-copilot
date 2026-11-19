import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto";
import { extractPostUrn } from "../src/linkedin";
import { LINKEDIN_VERSION, LinkedInGateway } from "../src/linkedin-api";
import { MemoryStore } from "./fakes";

describe("extractPostUrn", () => {
  it.each([
    ["https://www.linkedin.com/feed/update/urn:li:activity:7523368694966673408/", "urn:li:activity:7523368694966673408"],
    ["https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A7523368694966673408", "urn:li:share:7523368694966673408"],
    ["https://www.linkedin.com/posts/fulana_react-nextjs-activity-7523368694966673408-AbCd", "urn:li:activity:7523368694966673408"],
    ["https://www.linkedin.com/posts/fulana_titulo-ugcPost-7523368694966673408-xY", "urn:li:ugcPost:7523368694966673408"],
  ])("%s", (url, urn) => {
    expect(extractPostUrn(url)).toBe(urn);
  });

  it("devolve null quando o link não tem o identificador", () => {
    expect(extractPostUrn("https://lnkd.in/abc")).toBeNull();
    expect(extractPostUrn("https://www.linkedin.com/in/matheus-ferrazza/")).toBeNull();
  });
});

describe("criptografia do token", () => {
  it("criptografa e descriptografa; chave errada falha", async () => {
    const sealed = await encrypt("token-secreto", "chave-1");
    expect(sealed).not.toContain("token-secreto");
    expect(await decrypt(sealed, "chave-1")).toBe("token-secreto");
    await expect(decrypt(sealed, "chave-2")).rejects.toThrow();
  });
});

type Call = { url: string; init?: RequestInit };

function fakeHttp(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: Call[] = [];
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return routes[key](init);
  }) as typeof fetch;
  return { http, calls };
}

const NOW = new Date("2026-11-06T14:00:00Z");
const CFG = { clientId: "cid", clientSecret: "csecret", encryptionKey: "k".repeat(40) };

async function connected(routes: Record<string, (init?: RequestInit) => Response> = {}) {
  const store = new MemoryStore();
  await store.setSetting("public_url", "https://bot.example.workers.dev");
  const { http, calls } = fakeHttp({
    "oauth/v2/accessToken": () => Response.json({ access_token: "tok-123", expires_in: 5184000 }),
    "v2/userinfo": () => Response.json({ sub: "abc", name: "Matheus Ferrazza" }),
    ...routes,
  });
  const gw = new LinkedInGateway(store, CFG, () => NOW, http);
  const url = new URL((await gw.connectUrl())!);
  await gw.handleCallback("code-1", url.searchParams.get("state")!);
  return { gw, store, calls };
}

describe("LinkedInGateway", () => {
  it("monta o link de autorização com escopos, retorno e state", async () => {
    const store = new MemoryStore();
    await store.setSetting("public_url", "https://bot.example.workers.dev");
    const gw = new LinkedInGateway(store, CFG, () => NOW);
    const url = new URL((await gw.connectUrl())!);
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(url.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(url.searchParams.get("redirect_uri")).toBe("https://bot.example.workers.dev/linkedin/callback");
    expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("sem as chaves do app não oferece conexão", async () => {
    const gw = new LinkedInGateway(new MemoryStore(), {}, () => NOW);
    expect(await gw.connectUrl()).toBeNull();
    expect(await gw.connection()).toBeNull();
  });

  it("guarda o token criptografado e reconhece a conexão", async () => {
    const { gw, store } = await connected();
    expect(store.settings.get("li_token")).not.toContain("tok-123");
    expect(store.settings.get("li_person")).toBe("urn:li:person:abc");
    expect(await gw.connection()).toEqual({ name: "Matheus Ferrazza", expiresAt: "2027-01-05T14:00:00.000Z" });
  });

  it("recusa state errado (proteção contra conexão forjada)", async () => {
    const store = new MemoryStore();
    await store.setSetting("public_url", "https://bot.example.workers.dev");
    const { http } = fakeHttp({});
    const gw = new LinkedInGateway(store, CFG, () => NOW, http);
    await gw.connectUrl();
    await expect(gw.handleCallback("code", "state-falso")).rejects.toThrow("inválido ou expirado");
  });

  it("comenta com o token, a versão da API e o corpo esperados", async () => {
    const { gw, calls } = await connected({ "socialActions/": () => new Response(null, { status: 201 }) });
    await gw.comment("urn:li:activity:123", "Ótima reflexão");
    const call = calls.find((c) => c.url.includes("socialActions/"))!;
    expect(call.url).toBe("https://api.linkedin.com/rest/socialActions/urn%3Ali%3Aactivity%3A123/comments");
    const headers = call.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok-123");
    expect(headers["linkedin-version"]).toBe(LINKEDIN_VERSION);
    expect(JSON.parse(call.init!.body as string)).toEqual({
      actor: "urn:li:person:abc",
      object: "urn:li:activity:123",
      message: { text: "Ótima reflexão" },
    });
  });

  it("se a API nova negar o comentário, tenta a API antiga (/v2)", async () => {
    const { gw, calls } = await connected({
      "rest/socialActions/": () => new Response('{"code":"ACCESS_DENIED"}', { status: 403 }),
      "v2/socialActions/": () => new Response(null, { status: 201 }),
    });
    await gw.comment("urn:li:activity:123", "Oi");
    const v2 = calls.find((c) => c.url.includes("/v2/socialActions/"))!;
    expect(v2.url).toBe("https://api.linkedin.com/v2/socialActions/urn%3Ali%3Aactivity%3A123/comments");
    expect(JSON.parse(v2.init!.body as string)).toEqual({ actor: "urn:li:person:abc", message: { text: "Oi" } });
  });

  it("se as duas APIs negarem, explica que falta permissão", async () => {
    const { gw } = await connected({
      "rest/socialActions/": () => new Response("{}", { status: 403 }),
      "v2/socialActions/": () => new Response("{}", { status: 403 }),
    });
    await expect(gw.comment("urn:li:activity:123", "Oi")).rejects.toThrow("Community Management");
  });

  it("publica o post com uma imagem", async () => {
    const { gw, calls } = await connected({
      "images?action=initializeUpload": () => Response.json({ value: { uploadUrl: "https://upload.example/img", image: "urn:li:image:5" } }),
      "upload.example/img": () => new Response(null, { status: 201 }),
      "rest/posts": () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:79" } }),
    });
    const url = await gw.publishImage(new Uint8Array([9]), "Título", "Legenda");
    expect(url).toBe("https://www.linkedin.com/feed/update/urn:li:share:79/");
    const post = JSON.parse(calls.find((c) => c.url.endsWith("rest/posts"))!.init!.body as string);
    expect(post).toMatchObject({ author: "urn:li:person:abc", commentary: "Legenda", content: { media: { id: "urn:li:image:5", altText: "Título" } } });
  });
});
