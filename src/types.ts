export type PostStatus =
  | "needs_text" // só temos o link, falta o texto do post
  | "pending" // pronto para gerar sugestão às 18h
  | "drafted" // sugestão enviada, aguardando decisão
  | "approved" // comentário aprovado, falta colar no LinkedIn (modo manual)
  | "commented" // comentário publicado (pelo bot ou confirmado pelo usuário)
  | "skipped";

export interface Post {
  id: number;
  url: string;
  /** Identificador do post no LinkedIn (ex.: urn:li:activity:123), usado para comentar pela API. */
  urn: string | null;
  author: string | null;
  text: string | null;
  status: PostStatus;
  draft: string | null;
  final_comment: string | null;
  created_at: string;
}

export interface CarouselContent {
  titulo: string;
  subtitulo: string;
  slides: { titulo: string; texto: string }[];
  fechamento: { titulo: string; texto: string };
  legenda: string;
}

export type CarouselStatus =
  | "draft" // prévia enviada, aguardando decisão
  | "approved" // agendado para a próxima sexta, 18h
  | "published"
  | "failed" // a publicação automática falhou; o PDF foi enviado para postar à mão
  | "discarded";

export interface Carousel {
  id: number;
  topic: string;
  content: CarouselContent;
  status: CarouselStatus;
  created_at: string;
  published_at: string | null;
  post_url: string | null;
}

/** Números da semana copiados das Análises do LinkedIn. */
export interface WeeklyMetrics {
  week: string;
  profile_views: number;
  impressions: number;
  followers: number;
}

/** Perfil encontrado na busca, antes de ir para o banco. */
export interface RecruiterCandidate {
  name: string;
  headline: string;
  url: string;
  language: "pt" | "en" | "other";
}

export interface Recruiter {
  id: number;
  url: string;
  name: string;
  headline: string | null;
  language: "pt" | "en";
  note: string | null;
  week: string;
  batch: number;
  status: "suggested" | "invited";
  created_at: string;
}

/** Trabalho longo que o webhook deixa para o cron de cada minuto. */
export type Job =
  | { kind: "daily" }
  | { kind: "invites" }
  | { kind: "carousel"; chatId: number; topic: string; previousId?: number; instructions?: string };

export type ActionType = "comment" | "post" | "invite" | "ssi";

/** O que o bot está esperando como próxima mensagem de texto. */
export type Awaiting =
  | { type: "post_text"; postId: number }
  | { type: "edit"; postId: number }
  | { type: "carousel_topic" }
  | { type: "carousel_adjust"; carouselId: number }
  | { type: "metrics"; week: string };

export interface Store {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  addPost(p: { url: string; urn: string | null; author: string | null; text: string | null; status: PostStatus; createdAt: string }): Promise<number>;
  getPost(id: number): Promise<Post | null>;
  updatePost(id: number, patch: Partial<Pick<Post, "author" | "text" | "status" | "draft" | "final_comment">>): Promise<void>;
  listPosts(statuses: PostStatus[], limit: number): Promise<Post[]>;
  addCarousel(c: { topic: string; content: CarouselContent; createdAt: string }): Promise<number>;
  getCarousel(id: number): Promise<Carousel | null>;
  updateCarousel(id: number, patch: Partial<Pick<Carousel, "status" | "published_at" | "post_url">>): Promise<void>;
  listCarousels(statuses: CarouselStatus[]): Promise<Carousel[]>;
  saveMetrics(m: WeeklyMetrics, updatedAt: string): Promise<void>;
  /** Semanas a partir de `sinceWeek`, em ordem. */
  listMetrics(sinceWeek: string): Promise<WeeklyMetrics[]>;
  listActionsSince(sinceIso: string): Promise<{ type: ActionType; created_at: string }[]>;
  /** Todos os perfis já sugeridos, para não repetir. */
  knownRecruiterUrls(): Promise<string[]>;
  addRecruiters(rows: Omit<Recruiter, "id" | "status">[]): Promise<void>;
  listRecruiterBatch(week: string, batch: number): Promise<Recruiter[]>;
  markRecruitersInvited(ids: number[]): Promise<void>;
  enqueueJob(job: Job, createdAt: string): Promise<void>;
  /** Pega os trabalhos pendentes e marca como "running" (cada um roda uma vez só). */
  takeJobs(limit: number): Promise<{ id: number; job: Job }[]>;
  finishJob(id: number, ok: boolean): Promise<void>;
  logAction(type: ActionType, refId: number | null, createdAt: string, value?: number | null): Promise<void>;
  countActionsSince(sinceIso: string): Promise<Record<string, number>>;
}

/** Botão do Telegram: `data` volta para o bot quando tocado; `url` abre um link. */
export interface InlineButton {
  text: string;
  data?: string;
  url?: string;
}

export interface Messenger {
  /** Envia uma mensagem em HTML e devolve o id dela. */
  send(chatId: number, html: string, buttons?: InlineButton[][]): Promise<number>;
  edit(chatId: number, messageId: number, html: string, buttons?: InlineButton[][]): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  /** Álbum de imagens (até 10). */
  sendPhotos(chatId: number, images: Uint8Array[]): Promise<void>;
  sendDocument(chatId: number, file: Uint8Array, filename: string, caption?: string): Promise<void>;
}

export interface Drafter {
  draftComment(post: Pick<Post, "url" | "author" | "text">, avoid: string[]): Promise<string>;
  /** Escreve um carrossel; com `previous` + `instructions`, ajusta uma versão anterior. */
  draftCarousel(topic: string, previous?: CarouselContent, instructions?: string): Promise<CarouselContent>;
  /** Busca na web perfis públicos de recrutadores no LinkedIn, ignorando os de `exclude`. */
  findRecruiters(exclude: string[], want: number): Promise<RecruiterCandidate[]>;
}

export interface RenderedCarousel {
  pdf: Uint8Array;
  images: Uint8Array[];
}

export interface Renderer {
  render(c: CarouselContent): Promise<RenderedCarousel>;
}

export interface LinkedInConnection {
  name: string;
  expiresAt: string;
}

export interface LinkedIn {
  /** null quando as chaves do app do LinkedIn não estão configuradas. */
  connectUrl(): Promise<string | null>;
  connection(): Promise<LinkedInConnection | null>;
  comment(postUrn: string, text: string): Promise<void>;
  /** Publica no perfil e devolve o link do post. */
  publishCarousel(rendered: RenderedCarousel, title: string, caption: string): Promise<string>;
}

export interface Preview {
  author: string | null;
  text: string | null;
  /** Endereço final depois de seguir redirecionamentos (lnkd.in → linkedin.com). */
  url?: string | null;
}

export interface Deps {
  store: Store;
  messenger: Messenger;
  drafter: Drafter;
  renderer: Renderer;
  linkedin: LinkedIn;
  fetchPreview: (url: string) => Promise<Preview | null>;
  now: () => Date;
  /** Chat liberado por configuração; se vazio, o primeiro /start vira dono. */
  ownerChatId?: number;
  /**
   * No webhook, trabalhos longos vão para a fila (o Worker só tem ~30 s ali).
   * Sem isto (cron e testes), rodam na hora.
   */
  defer?: (job: Job) => Promise<void>;
  /** Assina links privados (página dos convites). Sem isto, o botão do link não aparece. */
  sign?: (payload: string) => Promise<string>;
}
