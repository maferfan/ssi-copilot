import type { BrowserWorker } from "@cloudflare/puppeteer";
import { Bot } from "./bot";
import { BrowserRenderer } from "./carousel";
import { ClaudeDrafter } from "./claude";
import { fetchPreview } from "./linkedin";
import { LinkedInGateway } from "./linkedin-api";
import { perfil } from "./perfil";
import { D1Store } from "./store";
import { TelegramMessenger, webhookSecret, type TgUpdate } from "./telegram";

export interface Env {
  DB: D1Database;
  BROWSER: BrowserWorker;
  TELEGRAM_BOT_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  /** Opcional: trava o bot num chat específico. */
  OWNER_CHAT_ID?: string;
}

function makeLinkedIn(env: Env, store: D1Store) {
  return new LinkedInGateway(store, {
    clientId: env.LINKEDIN_CLIENT_ID,
    clientSecret: env.LINKEDIN_CLIENT_SECRET,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
  });
}

function makeBot(env: Env) {
  const store = new D1Store(env.DB);
  return new Bot(
    {
      store,
      messenger: new TelegramMessenger(env.TELEGRAM_BOT_TOKEN),
      drafter: new ClaudeDrafter(env.ANTHROPIC_API_KEY, perfil),
      renderer: new BrowserRenderer(env.BROWSER),
      linkedin: makeLinkedIn(env, store),
      fetchPreview,
      now: () => new Date(),
      ownerChatId: env.OWNER_CHAT_ID ? Number(env.OWNER_CHAT_ID) : undefined,
    },
    perfil,
  );
}

function page(title: string, text: string, status = 200) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0d0e;color:#ece7de;font:18px/1.5 system-ui,sans-serif;padding:24px;text-align:center}h1{font-family:Georgia,serif;font-style:italic;font-weight:400}</style></head>
<body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const secret = await webhookSecret(env.TELEGRAM_BOT_TOKEN);

    // Telegram chama aqui a cada mensagem ou botão
    if (request.method === "POST" && url.pathname === "/telegram") {
      if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
        return new Response("forbidden", { status: 403 });
      }
      const update = (await request.json()) as TgUpdate;
      // Responde já e processa em segundo plano: o Telegram não reenvia a mensagem
      ctx.waitUntil(
        makeBot(env)
          .handleUpdate(update)
          .catch((err) => console.error("update falhou", err)),
      );
      return new Response("ok");
    }

    // Volta do login do LinkedIn (OAuth)
    if (request.method === "GET" && url.pathname === "/linkedin/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (!code || !state) {
        const reason = url.searchParams.get("error_description") ?? "O LinkedIn não autorizou a conexão.";
        return page("Não conectado", reason, 400);
      }
      try {
        const conn = await makeLinkedIn(env, new D1Store(env.DB)).handleCallback(code, state);
        ctx.waitUntil(makeBot(env).onLinkedInConnected(conn));
        return page("LinkedIn conectado ✔", "Pode fechar esta página e voltar para o Telegram.");
      } catch (err) {
        console.error("oauth falhou", err);
        return page("Não conectado", String((err as Error).message), 400);
      }
    }

    // Chamado pelo deploy para registrar o webhook. Exige o mesmo segredo.
    if (request.method === "POST" && url.pathname === "/setup") {
      if (request.headers.get("authorization") !== `Bearer ${secret}`) {
        return new Response("forbidden", { status: 403 });
      }
      await new D1Store(env.DB).setSetting("public_url", url.origin);
      const tg = new TelegramMessenger(env.TELEGRAM_BOT_TOKEN);
      await tg.setWebhook(`${url.origin}/telegram`, secret);
      await tg.setCommands();
      return new Response("webhook registrado");
    }

    return new Response("SSI Copilot no ar ✔", { headers: { "content-type": "text/plain; charset=utf-8" } });
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // 21:00 UTC = 18:00 em Brasília
    if (controller.cron === "0 21 * * *") {
      ctx.waitUntil(makeBot(env).runScheduled());
    }
  },
} satisfies ExportedHandler<Env>;
