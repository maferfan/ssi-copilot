/**
 * Quem você é e como você escreve. É daqui que o Claude tira o seu tom.
 * Edite à vontade: cada mudança vale a partir do próximo deploy.
 */
export const perfil = {
  nome: "Matheus Ferrazza",
  resumo:
    "Desenvolvedor web. Cria sites rápidos e bem desenhados para profissionais " +
    "(saúde, consultórios, serviços) e quer crescer na carreira de tecnologia.",
  objetivo: "Ser lembrado por recrutadores e clientes como um dev que entende de produto e entrega.",
  tom: [
    "Direto e humano, como alguém da área conversando, não como um robô elogiando.",
    "Acrescenta algo: uma experiência prática, um contraponto ou um detalhe técnico.",
    "Às vezes termina com uma pergunta curta e genuína para puxar conversa.",
  ],
  regras: [
    "Entre 2 e 4 frases. Nunca mais que 450 caracteres.",
    "Nada de 'Ótimo post!', 'Concordo totalmente' ou elogio vazio.",
    "Sem hashtags, sem links, no máximo um emoji (de preferência nenhum).",
    "Não inventar números, empresas ou experiências que o post não sustenta: se citar vivência, que seja genérica e plausível para um dev web.",
    "Escrever no mesmo idioma do post: post em inglês recebe comentário em inglês; em português, português do Brasil.",
  ],
  /** Exemplos de comentários seus. Quanto mais, melhor o tom. */
  exemplos: [] as string[],
  /** Perfis que você gosta de acompanhar: usados quando o dia passa sem posts salvos. */
  criadores: [] as { nome: string; url: string }[],
};

export type Perfil = typeof perfil;
