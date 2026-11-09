import type {
  ActionType,
  Carousel,
  CarouselContent,
  CarouselStatus,
  Deps,
  Drafter,
  Job,
  InlineButton,
  LinkedIn,
  LinkedInConnection,
  Messenger,
  Post,
  PostStatus,
  Preview,
  RenderedCarousel,
  TopicIdea,
  Renderer,
  Store,
  WeeklyMetrics,
} from "../src/types";

export class MemoryStore implements Store {
  settings = new Map<string, string>();
  posts: Post[] = [];
  carousels: Carousel[] = [];
  metrics = new Map<string, WeeklyMetrics>();
  jobs: { id: number; job: Job; status: string }[] = [];
  actions: { type: ActionType; refId: number | null; createdAt: string; value: number | null }[] = [];

  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string | null) {
    if (value === null) this.settings.delete(key);
    else this.settings.set(key, value);
  }
  async addPost(p: { url: string; urn: string | null; author: string | null; text: string | null; status: PostStatus; createdAt: string }) {
    const id = this.posts.length + 1;
    this.posts.push({ id, url: p.url, urn: p.urn, author: p.author, text: p.text, status: p.status, draft: null, final_comment: null, created_at: p.createdAt });
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
  async addCarousel(c: { topic: string; content: CarouselContent; createdAt: string }) {
    const id = this.carousels.length + 1;
    this.carousels.push({ id, topic: c.topic, content: c.content, status: "draft", created_at: c.createdAt, published_at: null, post_url: null, scheduled_for: null });
    return id;
  }
  async getCarousel(id: number) {
    const c = this.carousels.find((x) => x.id === id);
    return c ? { ...c } : null;
  }
  async updateCarousel(id: number, patch: Partial<Carousel>) {
    const c = this.carousels.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
  }
  async listCarousels(statuses: CarouselStatus[]) {
    return this.carousels.filter((c) => statuses.includes(c.status)).map((c) => ({ ...c }));
  }
  async saveMetrics(m: WeeklyMetrics) {
    this.metrics.set(m.week, { ...m });
  }
  async listMetrics(sinceWeek: string) {
    return [...this.metrics.values()].filter((m) => m.week >= sinceWeek).sort((a, b) => a.week.localeCompare(b.week));
  }
  async listActionsSince(sinceIso: string) {
    return this.actions.filter((a) => a.createdAt >= sinceIso).map((a) => ({ type: a.type, created_at: a.createdAt, value: a.value }));
  }
  async enqueueJob(job: Job) {
    this.jobs.push({ id: this.jobs.length + 1, job, status: "pending" });
  }
  async takeJobs(limit: number) {
    const picked = this.jobs.filter((j) => j.status === "pending").slice(0, limit);
    for (const j of picked) j.status = "running";
    return picked.map((j) => ({ id: j.id, job: j.job }));
  }
  async finishJob(id: number, ok: boolean) {
    const j = this.jobs.find((x) => x.id === id);
    if (j) j.status = ok ? "done" : "failed";
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
  photos: Uint8Array[][] = [];
  documents: { filename: string; caption?: string }[] = [];

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
  async sendPhotos(_chatId: number, images: Uint8Array[]) {
    this.photos.push(images);
  }
  async sendDocument(_chatId: number, _file: Uint8Array, filename: string, caption?: string) {
    this.documents.push({ filename, caption });
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
  /** Última mensagem enviada com botões (cartão de sugestão ou de carrossel). */
  lastCard() {
    return [...this.sent].reverse().find((s) => s.buttons);
  }
}

export function sampleCarousel(titulo = "Como escolher a stack"): CarouselContent {
  return {
    titulo,
    subtitulo: "Sem modinha",
    slides: [
      { titulo: "Comece pelo problema", texto: "..." },
      { titulo: "Pense na manutenção", texto: "..." },
      { titulo: "Meça antes", texto: "..." },
    ],
    fechamento: { titulo: "E você?", texto: "Conta aqui." },
    legenda: "Legenda do post",
  };
}

export class FakeDrafter implements Drafter {
  topicCalls = 0;
  topicResults: TopicIdea[] = [
    { titulo: "React Compiler is stable", area: "frontend", gancho: "Do you still need useMemo?", porque: "Lançamento recente.", fonte: "React Blog", url: "https://react.dev/blog/x" },
    { titulo: "Evals before prompts", area: "ai", gancho: "Your prompt is not the problem.", porque: "Debate em alta.", fonte: "InfoQ", url: "https://www.infoq.com/y" },
  ];
  async suggestTopics() {
    this.topicCalls++;
    return { items: this.topicResults, custo: { inputTokens: 1000, outputTokens: 100, searches: 3, usd: 0.04 } };
  }
  calls: { text: string | null; avoid: string[] }[] = [];
  carouselCalls: { topic: string; previous?: CarouselContent; instructions?: string }[] = [];
  async draftComment(post: Pick<Post, "text">, avoid: string[]) {
    this.calls.push({ text: post.text, avoid });
    return `Comentário ${this.calls.length}`;
  }
  async draftCarousel(topic: string, previous?: CarouselContent, instructions?: string) {
    this.carouselCalls.push({ topic, previous, instructions });
    return sampleCarousel(`Versão ${this.carouselCalls.length}`);
  }
}

export class FakeRenderer implements Renderer {
  calls = 0;
  async render(): Promise<RenderedCarousel> {
    this.calls++;
    return { pdf: new Uint8Array([1]), images: [new Uint8Array([2]), new Uint8Array([3])] };
  }
}

export class FakeLinkedIn implements LinkedIn {
  conn: LinkedInConnection | null = { name: "Matheus", expiresAt: "2027-01-01T00:00:00Z" };
  configured = true;
  comments: { urn: string; text: string }[] = [];
  published: { title: string; caption: string }[] = [];
  failComment: Error | null = null;
  failPublish: Error | null = null;

  async connectUrl() {
    return this.configured ? "https://www.linkedin.com/oauth/v2/authorization?x=1" : null;
  }
  async connection() {
    return this.conn;
  }
  async comment(urn: string, text: string) {
    if (this.failComment) throw this.failComment;
    this.comments.push({ urn, text });
  }
  async publishCarousel(_r: RenderedCarousel, title: string, caption: string) {
    if (this.failPublish) throw this.failPublish;
    this.published.push({ title, caption });
    return "https://www.linkedin.com/feed/update/urn:li:share:1/";
  }
}

export function makeDeps(over: Partial<Deps> & { preview?: Preview | null } = {}) {
  const store = new MemoryStore();
  const messenger = new FakeMessenger();
  const drafter = new FakeDrafter();
  const renderer = new FakeRenderer();
  const linkedin = new FakeLinkedIn();
  const deps: Deps = {
    store,
    messenger,
    drafter,
    renderer,
    linkedin,
    fetchPreview: async () => over.preview ?? null,
    // Sexta, 06/11/2026, 11h em Brasília
    now: () => new Date("2026-11-06T14:00:00Z"),
    ...over,
  };
  return { deps, store, messenger, drafter, renderer, linkedin };
}

let updateId = 0;
export const OWNER = 42;

export function msg(text: string, chatId = OWNER) {
  return { update_id: ++updateId, message: { message_id: updateId, chat: { id: chatId }, text } };
}

export function click(data: string, messageId = 1000, chatId = OWNER) {
  return { update_id: ++updateId, callback_query: { id: `cb${updateId}`, data, message: { message_id: messageId, chat: { id: chatId } } } };
}
