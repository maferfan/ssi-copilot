import type { ActionType, Deps, Drafter, InlineButton, Messenger, Post, PostStatus, Preview, Store } from "../src/types";

export class MemoryStore implements Store {
  settings = new Map<string, string>();
  posts: Post[] = [];
  actions: { type: ActionType; refId: number | null; createdAt: string; value: number | null }[] = [];

  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string | null) {
    if (value === null) this.settings.delete(key);
    else this.settings.set(key, value);
  }
  async addPost(p: { url: string; author: string | null; text: string | null; status: PostStatus; createdAt: string }) {
    const id = this.posts.length + 1;
    this.posts.push({ id, url: p.url, author: p.author, text: p.text, status: p.status, draft: null, final_comment: null, created_at: p.createdAt });
    return id;
  }
  async getPost(id: number) {
    const p = this.posts.find((x) => x.id === id);
    return p ? { ...p } : null;
  }
  async updatePost(id: number, patch: Partial<Post>) {
    const p = this.posts.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  }
  async listPosts(statuses: PostStatus[], limit: number) {
    return this.posts.filter((p) => statuses.includes(p.status)).slice(0, limit).map((p) => ({ ...p }));
  }
  async logAction(type: ActionType, refId: number | null, createdAt: string, value: number | null = null) {
    this.actions.push({ type, refId, createdAt, value });
  }
  async countActionsSince(sinceIso: string) {
    const out: Record<string, number> = {};
    for (const a of this.actions) if (a.createdAt >= sinceIso) out[a.type] = (out[a.type] ?? 0) + 1;
    return out;
  }
}

export interface Sent {
  chatId: number;
  html: string;
  buttons?: InlineButton[][];
  id: number;
}

export class FakeMessenger implements Messenger {
  sent: Sent[] = [];
  edits: { chatId: number; messageId: number; html: string; buttons?: InlineButton[][] }[] = [];
  answers: { id: string; text?: string }[] = [];

  async send(chatId: number, html: string, buttons?: InlineButton[][]) {
    const id = 1000 + this.sent.length;
    this.sent.push({ chatId, html, buttons, id });
    return id;
  }
  async edit(chatId: number, messageId: number, html: string, buttons?: InlineButton[][]) {
    this.edits.push({ chatId, messageId, html, buttons });
  }
  async answerCallback(id: string, text?: string) {
    this.answers.push({ id, text });
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

export class FakeDrafter implements Drafter {
  calls: { text: string | null; avoid: string[] }[] = [];
  async draftComment(post: Pick<Post, "text">, avoid: string[]) {
    this.calls.push({ text: post.text, avoid });
    return `Comentário ${this.calls.length}`;
  }
}

export function makeDeps(over: Partial<Deps> & { preview?: Preview | null } = {}) {
  const store = new MemoryStore();
  const messenger = new FakeMessenger();
  const drafter = new FakeDrafter();
  const deps: Deps = {
    store,
    messenger,
    drafter,
    fetchPreview: async () => over.preview ?? null,
    now: () => new Date("2026-11-06T21:00:00Z"),
    ...over,
  };
  return { deps, store, messenger, drafter };
}

let updateId = 0;
export const OWNER = 42;

export function msg(text: string, chatId = OWNER) {
  return { update_id: ++updateId, message: { message_id: updateId, chat: { id: chatId }, text } };
}

export function click(data: string, messageId = 1000, chatId = OWNER) {
  return { update_id: ++updateId, callback_query: { id: `cb${updateId}`, data, message: { message_id: messageId, chat: { id: chatId } } } };
}
