export type PostStatus =
  | "needs_text" // só temos o link, falta o texto do post
  | "pending" // pronto para gerar sugestão às 18h
  | "drafted" // sugestão enviada, aguardando decisão
  | "approved" // comentário aprovado, falta colar no LinkedIn
  | "commented" // usuário confirmou que comentou
  | "skipped";

export interface Post {
  id: number;
  url: string;
  author: string | null;
  text: string | null;
  status: PostStatus;
  draft: string | null;
  final_comment: string | null;
  created_at: string;
}

export type ActionType = "comment" | "post" | "invite" | "ssi";

/** O que o bot está esperando como próxima mensagem de texto. */
export type Awaiting =
  | { type: "post_text"; postId: number }
  | { type: "edit"; postId: number };

export interface Store {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
  addPost(p: { url: string; author: string | null; text: string | null; status: PostStatus; createdAt: string }): Promise<number>;
  getPost(id: number): Promise<Post | null>;
  updatePost(id: number, patch: Partial<Pick<Post, "author" | "text" | "status" | "draft" | "final_comment">>): Promise<void>;
  listPosts(statuses: PostStatus[], limit: number): Promise<Post[]>;
  logAction(type: ActionType, refId: number | null, createdAt: string, value?: number | null): Promise<void>;
  countActionsSince(sinceIso: string): Promise<Record<string, number>>;
}

export interface InlineButton {
  text: string;
  data: string;
}

export interface Messenger {
  /** Envia uma mensagem em HTML e devolve o id dela. */
  send(chatId: number, html: string, buttons?: InlineButton[][]): Promise<number>;
  edit(chatId: number, messageId: number, html: string, buttons?: InlineButton[][]): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
}

export interface Drafter {
  draftComment(post: Pick<Post, "url" | "author" | "text">, avoid: string[]): Promise<string>;
}

export interface Preview {
  author: string | null;
  text: string | null;
}

export interface Deps {
  store: Store;
  messenger: Messenger;
  drafter: Drafter;
  fetchPreview: (url: string) => Promise<Preview | null>;
  now: () => Date;
  /** Chat liberado por configuração; se vazio, o primeiro /start vira dono. */
  ownerChatId?: number;
}
