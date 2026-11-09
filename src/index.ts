import type { BrowserWorker } from "@cloudflare/puppeteer";
import { Bot } from "./bot";
import { BrowserRenderer } from "./carousel";
import { ClaudeDrafter } from "./claude";
import { FluxIllustrator } from "./illustrator";
import { CRONS } from "./crons";
import { dashboardHtml, loadDashboard } from "./dashboard";
import { fetchPreview } from "./linkedin";
import { LinkedInGateway } from "./linkedin-api";
import { perfil } from "./perfil";
import { D1Store } from "./store";
import { TelegramMessenger, webhookSecret, type TgUpdate } from "./telegram";

export interface Env {
  DB: D1Database;
  BROWSER: BrowserWorker;
  /** Workers AI: ilustração da capa (Flux). */
  AI: Ai;
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

/** `web`: chamado pelo webhook, onde trabalhos longos vão para a fila. */
function makeBot(env: Env, web = false) {
  const store = new D1Store(env.DB);
  const now = () => new Date();
  return new Bot(
    {
      store,
      messenger: new TelegramMessenger(env.TELEGRAM_BOT_TOKEN),
      drafter: new ClaudeDrafter(env.ANTHROPIC_API_KEY, perfil),
      renderer: new BrowserRenderer(env.BROWSER),
      linkedin: makeLinkedIn(env, store),
      fetchPreview,
      now,
      ownerChatId: env.OWNER_CHAT_ID ? Number(env.OWNER_CHAT_ID) : undefined,
      defer: web ? (job) => store.enqueueJob(job, now().toISOString()) : undefined,
      illustrator: env.AI ? new FluxIllustrator(env.AI) : undefined,
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

const JOB_LABEL: Record<string, string> = {
  daily: "Gerar as sugestões de comentário",
  carousel: "Montar o carrossel",
  topics: "A busca de temas",
};

/** Roda algo agendado e, se der erro, avisa no Telegram em vez de só gravar no log. */
async function guarded(env: Env, what: string, run: (bot: ReturnType<typeof makeBot>) => Promise<void>) {
  const bot = makeBot(env);
  try {
    await run(bot);
  } catch (err) {
    console.error(what, err);
    await bot.reportFailure(what, err).catch(() => {});
  }
}

async function runQueue(env: Env) {
  const store = new D1Store(env.DB);
  const jobs = await store.takeJobs(3);
  if (jobs.length === 0) return;
  const bot = makeBot(env);
  for (const { id, job } of jobs) {
    try {
      await bot.runJob(job);
      await store.finishJob(id, true);
    } catch (err) {
      console.error("trabalho falhou", job.kind, err);
      await store.finishJob(id, false);
      await bot.reportFailure(JOB_LABEL[job.kind], err).catch(() => {});
    }
  }
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
        makeBot(env, true)
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

    // Painel público com as ações da semana e os números do LinkedIn
    if (request.method === "GET" && url.pathname === "/dashboard") {
      const data = await loadDashboard(new D1Store(env.DB), new Date());
      return new Response(dashboardHtml(data), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
      });
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
    if (controller.cron === CRONS.daily) {
      ctx.waitUntil(guarded(env, "A rodada das 18h", (bot) => bot.runScheduled()));
    }
    // A cada minuto: roda os trabalhos longos pedidos pelo Telegram (até 15 min aqui, contra ~30 s no webhook)
    if (controller.cron === CRONS.queue) {
      ctx.waitUntil(runQueue(env));
    }
  },
} satisfies ExportedHandler<Env>;
