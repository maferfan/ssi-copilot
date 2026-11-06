import { Bot } from "./bot";
import { ClaudeDrafter } from "./claude";
import { fetchPreview } from "./linkedin";
import { perfil } from "./perfil";
import { D1Store } from "./store";
import { TelegramMessenger, webhookSecret, type TgUpdate } from "./telegram";

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  /** Opcional: trava o bot num chat específico. */
  OWNER_CHAT_ID?: string;
}

function makeBot(env: Env) {
  return new Bot(
    {
      store: new D1Store(env.DB),
      messenger: new TelegramMessenger(env.TELEGRAM_BOT_TOKEN),
      drafter: new ClaudeDrafter(env.ANTHROPIC_API_KEY, perfil),
      fetchPreview,
      now: () => new Date(),
      ownerChatId: env.OWNER_CHAT_ID ? Number(env.OWNER_CHAT_ID) : undefined,
    },
    perfil,
  );
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

    // Chamado pelo deploy para registrar o webhook. Exige o mesmo segredo.
    if (request.method === "POST" && url.pathname === "/setup") {
      if (request.headers.get("authorization") !== `Bearer ${secret}`) {
        return new Response("forbidden", { status: 403 });
      }
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
      ctx.waitUntil(makeBot(env).runDaily());
    }
  },
} satisfies ExportedHandler<Env>;
