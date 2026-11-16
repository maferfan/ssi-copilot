/**
 * Quem você é e como você escreve. É daqui que o Claude tira o seu tom.
 * Edite à vontade: cada mudança vale a partir do próximo deploy.
 */
export const perfil = {
  nome: "Matheus Ferrazza",
  resumo:
    "Engenheiro de Software Full Stack (pleno), cerca de 3 anos de experiência remota com React, " +
    "Next.js, TypeScript e Node.js: performance de front-end, design system e uso de IA no desenvolvimento.",
  objetivo: "Ser lembrado por recrutadores e tech leads como um dev que entende de produto e entrega, e ser chamado para entrevistas.",
  tom: [
    "Direto e humano, como alguém da área conversando, não como um robô elogiando.",
    "Acrescenta algo: uma experiência prática, um contraponto ou um detalhe técnico.",
    "Às vezes termina com uma pergunta curta e genuína para puxar conversa.",
  ],
  regras: [
    "Entre 2 e 4 frases. Nunca mais que 450 caracteres.",
    "Nada de 'Ótimo post!', 'Concordo totalmente' ou elogio vazio.",
    "Sem hashtags, sem links, no máximo um emoji (de preferência nenhum).",
    "Não inventar números, empresas ou experiências que o post não sustenta: se citar vivência, que seja genérica e plausível para um engenheiro full stack (front-end com React/Next, APIs em Node, performance, design system, times de produto).",
    "Nunca falar de clientes, consultórios, clínicas, área da saúde ou de vender serviço: o assunto é carreira e engenharia de software.",
    "Escrever no mesmo idioma do post: post em inglês recebe comentário em inglês; em português, português do Brasil.",
  ],
  /** Exemplos de comentários seus. Quanto mais, melhor o tom. */
  exemplos: [] as string[],
  /** Base da busca de vagas (/vagas), tirada do currículo. Sem dados de contato. */
  curriculo: {
    cargo: "Engenheiro de Software Full Stack (pleno)",
    experiencia: "cerca de 3 anos (desde 2023), remoto",
    stack: ["React", "Next.js", "TypeScript", "Node.js", "React Native", "Angular", "Redux", "Zustand", "Tailwind", "REST APIs", "AWS", "GCP", "Azure", "Docker", "Jest", "Cypress"],
    destaques: [
      "Otimizou aplicações usadas por mais de 1 milhão de usuários (gerenciamento de estado, desempenho)",
      "Design system em React + TypeScript que reduziu em 50% o tempo de desenvolvimento",
      "Usa IA no desenvolvimento (Claude) e construiu um bot com a Claude API em produção",
    ],
    idiomas: "Português nativo, inglês profissional pleno",
    local: "Joinville, SC, Brasil (aceita remoto)",
  },
  /** Perfis que você gosta de acompanhar: usados quando o dia passa sem posts salvos. */
  criadores: [] as { nome: string; url: string }[],
};

export type Perfil = typeof perfil;
