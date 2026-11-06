import { decrypt, encrypt, randomHex } from "./crypto";
import type { LinkedIn, LinkedInConnection, RenderedCarousel, Store } from "./types";

/** Versão da API REST do LinkedIn (formato AAAAMM). O LinkedIn aceita versões de até ~1 ano atrás. */
export const LINKEDIN_VERSION = "202609";
export const SCOPES = "openid profile w_member_social";

const KEYS = {
  token: "li_token",
  person: "li_person",
  name: "li_name",
  expires: "li_expires",
  state: "li_oauth_state",
  publicUrl: "public_url",
};

export interface LinkedInConfig {
  clientId?: string;
  clientSecret?: string;
  encryptionKey?: string;
}

export class LinkedInApiError extends Error {
  constructor(
    public status: number,
    public body: string,
    action: string,
  ) {
    super(`LinkedIn ${action}: HTTP ${status} ${body.slice(0, 200)}`);
  }
}

/** Conexão OAuth com o LinkedIn + chamadas à API oficial (comentar e publicar). */
export class LinkedInGateway implements LinkedIn {
  constructor(
    private store: Store,
    private cfg: LinkedInConfig,
    private now: () => Date = () => new Date(),
    private http: typeof fetch = (...args) => fetch(...args),
  ) {}

  private get configured() {
    return Boolean(this.cfg.clientId && this.cfg.clientSecret && this.cfg.encryptionKey);
  }

  private async redirectUri() {
    const base = await this.store.getSetting(KEYS.publicUrl);
    if (!base) throw new Error("Endereço público do bot desconhecido (rode o deploy de novo).");
    return `${base}/linkedin/callback`;
  }

  // ---------- OAuth ----------

  async connectUrl(): Promise<string | null> {
    if (!this.configured) return null;
    const state = randomHex();
    const exp = this.now().getTime() + 15 * 60 * 1000;
    await this.store.setSetting(KEYS.state, JSON.stringify({ state, exp }));
    const q = new URLSearchParams({
      response_type: "code",
      client_id: this.cfg.clientId!,
      redirect_uri: await this.redirectUri(),
      state,
      scope: SCOPES,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
  }

  /** Troca o código do LinkedIn por um token e guarda tudo criptografado. */
  async handleCallback(code: string, state: string): Promise<LinkedInConnection> {
    if (!this.configured) throw new Error("App do LinkedIn não configurado.");
    const saved = await this.store.getSetting(KEYS.state);
    await this.store.setSetting(KEYS.state, null);
    const expected = saved ? (JSON.parse(saved) as { state: string; exp: number }) : null;
    if (!expected || expected.state !== state || expected.exp < this.now().getTime()) {
      throw new Error("Link de conexão inválido ou expirado. Mande /conectar de novo.");
    }

    const tokenRes = await this.http("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: await this.redirectUri(),
        client_id: this.cfg.clientId!,
        client_secret: this.cfg.clientSecret!,
      }),
    });
    if (!tokenRes.ok) throw new LinkedInApiError(tokenRes.status, await tokenRes.text(), "token");
    const token = (await tokenRes.json()) as { access_token: string; expires_in: number };

    const meRes = await this.http("https://api.linkedin.com/v2/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!meRes.ok) throw new LinkedInApiError(meRes.status, await meRes.text(), "userinfo");
    const me = (await meRes.json()) as { sub: string; name?: string };

    const expiresAt = new Date(this.now().getTime() + token.expires_in * 1000).toISOString();
    await this.store.setSetting(KEYS.token, await encrypt(token.access_token, this.cfg.encryptionKey!));
    await this.store.setSetting(KEYS.person, `urn:li:person:${me.sub}`);
    await this.store.setSetting(KEYS.name, me.name ?? "você");
    await this.store.setSetting(KEYS.expires, expiresAt);
    return { name: me.name ?? "você", expiresAt };
  }

  async connection(): Promise<LinkedInConnection | null> {
    if (!this.configured) return null;
    const [token, name, expiresAt] = await Promise.all([
      this.store.getSetting(KEYS.token),
      this.store.getSetting(KEYS.name),
      this.store.getSetting(KEYS.expires),
    ]);
    if (!token || !expiresAt || new Date(expiresAt) <= this.now()) return null;
    return { name: name ?? "você", expiresAt };
  }

  private async auth(): Promise<{ token: string; person: string }> {
    if (!(await this.connection())) throw new Error("LinkedIn não conectado. Mande /conectar.");
    const sealed = (await this.store.getSetting(KEYS.token))!;
    const person = (await this.store.getSetting(KEYS.person))!;
    return { token: await decrypt(sealed, this.cfg.encryptionKey!), person };
  }

  private async rest(token: string, path: string, init: { method: string; body?: unknown }, action: string) {
    const res = await this.http(`https://api.linkedin.com/rest/${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        "linkedin-version": LINKEDIN_VERSION,
        "x-restli-protocol-version": "2.0.0",
        "content-type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) throw new LinkedInApiError(res.status, await res.text(), action);
    return res;
  }

  // ---------- comentar ----------

  async comment(postUrn: string, text: string): Promise<void> {
    const { token, person } = await this.auth();
    await this.rest(
      token,
      `socialActions/${encodeURIComponent(postUrn)}/comments`,
      { method: "POST", body: { actor: person, object: postUrn, message: { text } } },
      "comentário",
    );
  }

  // ---------- publicar carrossel ----------

  private async upload(token: string, kind: "documents" | "images", owner: string, bytes: Uint8Array) {
    const init = await this.rest(token, `${kind}?action=initializeUpload`, { method: "POST", body: { initializeUploadRequest: { owner } } }, `upload (${kind})`);
    const { value } = (await init.json()) as { value: { uploadUrl: string; document?: string; image?: string } };
    const put = await this.http(value.uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${token}` }, body: bytes });
    if (!put.ok) throw new LinkedInApiError(put.status, await put.text(), `envio do arquivo (${kind})`);
    return (value.document ?? value.image)!;
  }

  private async createPost(token: string, person: string, caption: string, content: unknown) {
    const res = await this.rest(
      token,
      "posts",
      {
        method: "POST",
        body: {
          author: person,
          commentary: caption,
          visibility: "PUBLIC",
          distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
          content,
          lifecycleState: "PUBLISHED",
          isReshareDisabledByAuthor: false,
        },
      },
      "post",
    );
    const urn = res.headers.get("x-restli-id");
    return urn ? `https://www.linkedin.com/feed/update/${urn}/` : "https://www.linkedin.com/in/me/recent-activity/all/";
  }

  /** Tenta como documento (carrossel em PDF); se o LinkedIn negar, publica como várias imagens. */
  async publishCarousel(rendered: RenderedCarousel, title: string, caption: string): Promise<string> {
    const { token, person } = await this.auth();
    try {
      const document = await this.upload(token, "documents", person, rendered.pdf);
      await this.waitAvailable(token, document);
      return await this.createPost(token, person, caption, { media: { title, id: document } });
    } catch (err) {
      if (!(err instanceof LinkedInApiError) || ![400, 401, 403, 422].includes(err.status)) throw err;
      const ids: string[] = [];
      for (const img of rendered.images) ids.push(await this.upload(token, "images", person, img));
      return await this.createPost(token, person, caption, {
        multiImage: { images: ids.map((id, i) => ({ id, altText: `${title} — slide ${i + 1}` })) },
      });
    }
  }

  /** O LinkedIn processa o PDF por alguns segundos antes de aceitar o post. */
  private async waitAvailable(token: string, document: string) {
    for (let i = 0; i < 10; i++) {
      try {
        const res = await this.rest(token, `documents/${encodeURIComponent(document)}`, { method: "GET" }, "status do documento");
        const { status } = (await res.json()) as { status?: string };
        if (status === "AVAILABLE") return;
        if (status === "PROCESSING_FAILED") throw new Error("O LinkedIn não conseguiu processar o PDF.");
      } catch (err) {
        if (!(err instanceof LinkedInApiError)) throw err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
