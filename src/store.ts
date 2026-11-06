import type { ActionType, Post, PostStatus, Store } from "./types";

/** Implementação do Store em cima do Cloudflare D1. */
export class D1Store implements Store {
  constructor(private db: D1Database) {}

  async getSetting(key: string) {
    const row = await this.db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string | null) {
    if (value === null) {
      await this.db.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
      return;
    }
    await this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(key, value)
      .run();
  }

  async addPost(p: { url: string; author: string | null; text: string | null; status: PostStatus; createdAt: string }) {
    const row = await this.db
      .prepare("INSERT INTO posts (url, author, text, status, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .bind(p.url, p.author, p.text, p.status, p.createdAt)
      .first<{ id: number }>();
    if (!row) throw new Error("Falha ao salvar o post");
    return row.id;
  }

  async getPost(id: number) {
    return (await this.db.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first<Post>()) ?? null;
  }

  async updatePost(id: number, patch: Partial<Pick<Post, "author" | "text" | "status" | "draft" | "final_comment">>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    await this.db
      .prepare(`UPDATE posts SET ${sets} WHERE id = ?`)
      .bind(...keys.map((k) => patch[k] ?? null), id)
      .run();
  }

  async listPosts(statuses: PostStatus[], limit: number) {
    const marks = statuses.map(() => "?").join(", ");
    const { results } = await this.db
      .prepare(`SELECT * FROM posts WHERE status IN (${marks}) ORDER BY created_at, id LIMIT ?`)
      .bind(...statuses, limit)
      .all<Post>();
    return results;
  }

  async logAction(type: ActionType, refId: number | null, createdAt: string, value: number | null = null) {
    await this.db
      .prepare("INSERT INTO actions (type, ref_id, value, created_at) VALUES (?, ?, ?, ?)")
      .bind(type, refId, value, createdAt)
      .run();
  }

  async countActionsSince(sinceIso: string) {
    const { results } = await this.db
      .prepare("SELECT type, COUNT(*) AS n FROM actions WHERE created_at >= ? GROUP BY type")
      .bind(sinceIso)
      .all<{ type: string; n: number }>();
    return Object.fromEntries(results.map((r) => [r.type, r.n]));
  }
}
