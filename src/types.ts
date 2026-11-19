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

/** Tokens e buscas gastos numa chamada (ou num pedido) ao Claude. */
export interface Cost {
  inputTokens: number;
  outputTokens: number;
  searches: number;
  usd: number;
}

/** Infográfico de uma imagem: passo a passo ou errado × certo. */
export interface ImagePost {
  layout: "steps" | "compare";
  passos: { titulo: string; texto: string }[];
  ruim: { titulo: string; itens: string[] };
  bom: { titulo: string; itens: string[] };
}

/** Conteúdo do post de imagem (guardado em JSON; os nomes dos campos ficam por compatibilidade). */
export interface PostContent {
  /** Título da arte (com um **destaque**). */
  titulo: string;
  subtitulo: string;
  /** Descrição (em inglês) da ilustração, escrita pelo Claude. */
  imagem_prompt?: string;
  /** Ilustração gerada pelo Flux (data URL JPEG); fica guardada para a publicação. */
  capa_imagem?: string;
  /** O infográfico. Rascunhos antigos (do tempo dos carrosséis) não têm. */
  imagem?: ImagePost;
  /** Texto do post (português e inglês). */
  legenda: string;
  custo?: Cost;
}

export type DraftStatus =
  | "draft" // prévia enviada, aguardando decisão
  | "approved" // agendado para uma terça, 8h30
  | "published"
  | "failed" // a publicação automática falhou; a imagem foi enviada para postar à mão
  | "discarded";

/** Post de imagem (fica na tabela `carousels`, do tempo em que o bot fazia carrosséis). */
export interface PostDraft {
  id: number;
  topic: string;
  content: PostContent;
  status: DraftStatus;
  created_at: string;
  published_at: string | null;
  post_url: string | null;
  /** Terça em que sai (AAAA-MM-DD, horário de Brasília); só para aprovados. */
  scheduled_for: string | null;
}

/** Números da semana copiados das Análises do LinkedIn. */
export interface WeeklyMetrics {
  week: string;
  profile_views: number;
  impressions: number;
  followers: number;
}

/** Trabalho longo que o webhook deixa para o cron de cada minuto. */
export type Job =
  | { kind: "daily" }
  | { kind: "post"; chatId: number; topic: string; previousId?: number; instructions?: string }
  | { kind: "topics"; chatId: number }
  /** Nova ilustração do post; sem `scene`, usa a mesma ideia da anterior. */
  | { kind: "image"; chatId: number; draftId: number; scene?: string };

export type ActionType = "comment" | "post" | "invite" | "ssi";

/** O que o bot está esperando como próxima mensagem de texto. */
export type Awaiting =
  | { type: "post_text"; postId: number }
  | { type: "edit"; postId: number }
  | { type: "post_topic" }
  | { type: "post_adjust"; draftId: number }
  | { type: "metrics"; week: string }
  | { type: "invites" }
  | { type: "post_image"; draftId: number };

export interface Store {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  addPost(p: { url: string; urn: string | null; author: string | null; text: string | null; status: PostStatus; createdAt: string }): Promise<number>;
  getPost(id: number): Promise<Post | null>;
  updatePost(id: number, patch: Partial<Pick<Post, "author" | "text" | "status" | "draft" | "final_comment">>): Promise<void>;
  listPosts(statuses: PostStatus[], limit: number): Promise<Post[]>;
  addDraft(c: { topic: string; content: PostContent; createdAt: string }): Promise<number>;
  getDraft(id: number): Promise<PostDraft | null>;
  updateDraft(id: number, patch: Partial<Pick<PostDraft, "status" | "published_at" | "post_url" | "scheduled_for">>): Promise<void>;
  listDrafts(statuses: DraftStatus[]): Promise<PostDraft[]>;
  saveMetrics(m: WeeklyMetrics, updatedAt: string): Promise<void>;
  /** Semanas a partir de `sinceWeek`, em ordem. */
  listMetrics(sinceWeek: string): Promise<WeeklyMetrics[]>;
  /** `value` é a quantidade (ex.: convites registrados de uma vez); vazio vale 1. */
  listActionsSince(sinceIso: string): Promise<{ type: ActionType; created_at: string; value: number | null }[]>;
  enqueueJob(job: Job, createdAt: string): Promise<void>;
  /** Pega os trabalhos pendentes e marca como "running" (cada um roda uma vez só). */
  takeJobs(limit: number): Promise<{ id: number; job: Job }[]>;
  finishJob(id: number, ok: boolean): Promise<void>;
  /** Custo de uma chamada ao Claude (em US$), para o /custos e o teto mensal. */
  addCost(kind: string, usd: number, createdAt: string): Promise<void>;
  /** Total e quantidade de chamadas por tipo, a partir de `sinceIso`. */
  costsSince(sinceIso: string): Promise<{ kind: string; usd: number; n: number }[]>;
  /** Quantos trabalhos há em cada estado (pending, running, done, failed). */
  jobCounts(): Promise<Record<string, number>>;
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
}

/** O "post" salvo não é um post de verdade (ex.: texto da tela de login do LinkedIn). */
export class NotAPostError extends Error {
  constructor() {
    super("o texto salvo não é o do post");
  }
}

/** Tema sugerido pelo /temas, com a fonte que mostra que o assunto está em alta. */
export interface TopicIdea {
  titulo: string;
  area: "software" | "frontend" | "ai";
  gancho: string;
  porque: string;
  fonte: string;
  url: string;
  /** O site do link apareceu nos resultados da busca. */
  conferido?: boolean;
}

/** Gera a ilustração do post. Devolve null se não der (a arte sai sem ela). */
export interface Illustrator {
  generate(prompt: string): Promise<string | null>;
}

export interface Drafter {
  draftComment(post: Pick<Post, "url" | "author" | "text">, avoid: string[]): Promise<string>;
  /** Post de imagem única (infográfico); com `previous` + `instructions`, ajusta. */
  draftImagePost(topic: string, previous?: PostContent, instructions?: string): Promise<PostContent>;
  /** Transforma a cena descrita pelo usuário (qualquer idioma) numa descrição em inglês para o Flux. */
  sceneToPrompt(scene: string): Promise<string>;
  /** Pesquisa na web os assuntos em alta (software, front-end, IA) e sugere temas de post. */
  suggestTopics(): Promise<{ items: TopicIdea[]; custo: Cost; sugeridos: number; links: number }>;
}

export interface Renderer {
  /** A arte do post, em PNG. */
  render(c: PostContent): Promise<Uint8Array>;
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
  /** Post com uma imagem só; devolve o link do post. */
  publishImage(image: Uint8Array, altText: string, caption: string): Promise<string>;
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
  /** Versão publicada (commit), para o /status. */
  version?: string;
  /** Ilustração do post (Flux na Cloudflare). Sem isto, a arte sai sem ela. */
  illustrator?: Illustrator;
}
