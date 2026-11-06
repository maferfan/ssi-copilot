import type { ActionType, Carousel, CarouselContent, CarouselStatus, Job, Post, PostStatus, Store, WeeklyMetrics } from "./types";

interface CarouselRow extends Omit<Carousel, "content"> {
  content: string;
}

const toCarousel = (r: CarouselRow): Carousel => ({ ...r, content: JSON.parse(r.content) as CarouselContent });

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

  async addPost(p: { url: string; urn: string | null; author: string | null; text: string | null; status: PostStatus; createdAt: string }) {
    const row = await this.db
      .prepare("INSERT INTO posts (url, urn, author, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(p.url, p.urn, p.author, p.text, p.status, p.createdAt)
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

  async addCarousel(c: { topic: string; content: CarouselContent; createdAt: string }) {
    const row = await this.db
      .prepare("INSERT INTO carousels (topic, content, status, created_at) VALUES (?, ?, 'draft', ?) RETURNING id")
      .bind(c.topic, JSON.stringify(c.content), c.createdAt)
      .first<{ id: number }>();
    if (!row) throw new Error("Falha ao salvar o carrossel");
    return row.id;
  }

  async getCarousel(id: number) {
    const row = await this.db.prepare("SELECT * FROM carousels WHERE id = ?").bind(id).first<CarouselRow>();
    return row ? toCarousel(row) : null;
  }

  async updateCarousel(id: number, patch: Partial<Pick<Carousel, "status" | "published_at" | "post_url">>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    if (keys.length === 0) return;
    await this.db
      .prepare(`UPDATE carousels SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...keys.map((k) => patch[k] ?? null), id)
      .run();
  }

  async listCarousels(statuses: CarouselStatus[]) {
    const marks = statuses.map(() => "?").join(", ");
    const { results } = await this.db
      .prepare(`SELECT * FROM carousels WHERE status IN (${marks}) ORDER BY created_at, id`)
      .bind(...statuses)
      .all<CarouselRow>();
    return results.map(toCarousel);
  }

  async saveMetrics(m: WeeklyMetrics, updatedAt: string) {
    await this.db
      .prepare(
        `INSERT INTO metrics (week, profile_views, impressions, followers, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(week) DO UPDATE SET profile_views = excluded.profile_views, impressions = excluded.impressions,
           followers = excluded.followers, updated_at = excluded.updated_at`,
      )
      .bind(m.week, m.profile_views, m.impressions, m.followers, updatedAt)
      .run();
  }

  async listMetrics(sinceWeek: string) {
    const { results } = await this.db
      .prepare("SELECT week, profile_views, impressions, followers FROM metrics WHERE week >= ? ORDER BY week")
      .bind(sinceWeek)
      .all<WeeklyMetrics>();
    return results;
  }

  async listActionsSince(sinceIso: string) {
    const { results } = await this.db
      .prepare("SELECT type, created_at, value FROM actions WHERE created_at >= ? ORDER BY created_at")
      .bind(sinceIso)
      .all<{ type: ActionType; created_at: string; value: number | null }>();
    return results;
  }

  async enqueueJob(job: Job, createdAt: string) {
    await this.db
      .prepare("INSERT INTO jobs (kind, payload, status, created_at) VALUES (?, ?, 'pending', ?)")
      .bind(job.kind, JSON.stringify(job), createdAt)
      .run();
  }

  async takeJobs(limit: number) {
    // UPDATE ... RETURNING marca e devolve de uma vez: dois crons não pegam o mesmo trabalho
    const { results } = await this.db
      .prepare(
        "UPDATE jobs SET status = 'running' WHERE id IN (SELECT id FROM jobs WHERE status = 'pending' ORDER BY id LIMIT ?) RETURNING id, payload",
      )
      .bind(limit)
      .all<{ id: number; payload: string }>();
    return results.sort((a, b) => a.id - b.id).map((r) => ({ id: r.id, job: JSON.parse(r.payload) as Job }));
  }

  async finishJob(id: number, ok: boolean) {
    await this.db.prepare("UPDATE jobs SET status = ? WHERE id = ?").bind(ok ? "done" : "failed", id).run();
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
