import type { InlineButton, Messenger } from "./types";

/** Parte mínima de um Update do Telegram que o bot usa. */
export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    caption?: string;
    entities?: { type: string; offset: number; length: number; url?: string }[];
    caption_entities?: { type: string; offset: number; length: number; url?: string }[];
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
}

function keyboard(buttons?: InlineButton[][]) {
  return buttons
    ? { inline_keyboard: buttons.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))) }
    : undefined;
}

export class TelegramMessenger implements Messenger {
  constructor(private token: string) {}

  private async call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
    return json.result;
  }

  async send(chatId: number, html: string, buttons?: InlineButton[][]) {
    const msg = await this.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard(buttons),
    });
    return msg.message_id;
  }

  async edit(chatId: number, messageId: number, html: string, buttons?: InlineButton[][]) {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard(buttons) ?? { inline_keyboard: [] },
    });
  }

  async answerCallback(callbackId: string, text?: string) {
    await this.call("answerCallbackQuery", { callback_query_id: callbackId, text });
  }

  private async upload(method: string, form: FormData) {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: "POST", body: form });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  }

  async sendPhotos(chatId: number, images: Uint8Array[]) {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("media", JSON.stringify(images.slice(0, 10).map((_, i) => ({ type: "photo", media: `attach://slide${i}` }))));
    images.slice(0, 10).forEach((img, i) => form.set(`slide${i}`, new Blob([img], { type: "image/png" }), `slide-${i + 1}.png`));
    await this.upload("sendMediaGroup", form);
  }

  async sendDocument(chatId: number, file: Uint8Array, filename: string, caption?: string) {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("document", new Blob([file], { type: "application/pdf" }), filename);
    if (caption) {
      form.set("caption", caption);
      form.set("parse_mode", "HTML");
    }
    await this.upload("sendDocument", form);
  }

  async setWebhook(url: string, secretToken: string) {
    return this.call<boolean>("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    });
  }

  async setCommands() {
    return this.call<boolean>("setMyCommands", {
      commands: [
        { command: "agora", description: "Gerar as sugestões de comentário agora" },
        { command: "carrossel", description: "Criar o carrossel de sexta: /carrossel <tema>" },
        { command: "conectar", description: "Conectar ou ver a conexão com o LinkedIn" },
        { command: "fila", description: "Ver os posts salvos" },
        { command: "semana", description: "Resumo da semana" },
        { command: "metricas", description: "Registrar os números da semana (Análises do LinkedIn)" },
        { command: "convites", description: "Registrar convites e ver quantos faltam na semana" },
        { command: "painel", description: "Link do dashboard" },
        { command: "ajuda", description: "Como usar o bot" },
      ],
    });
  }
}

/** Segredo do webhook derivado do token: nada a mais para configurar. */
export async function webhookSecret(botToken: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ssi-copilot:${botToken}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}
