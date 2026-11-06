# SSI Copilot

Um copiloto pessoal para aumentar o **SSI (Social Selling Index) do LinkedIn** sem depender de memória e sem arriscar a conta.

## O problema

Subir o SSI exige constância: comentar em posts, publicar conteúdo e ampliar a rede com as pessoas certas. O difícil não é saber o que fazer, é **lembrar de fazer todo dia**.

Automatizar tudo com bots resolveria a constância, mas o LinkedIn proíbe automação em contas pessoais e restringe quem usa. Seria arriscar justamente o perfil que se quer valorizar.

## A solução: automação com aprovação humana

O sistema faz a parte chata (lembrar, ler, escrever o rascunho) e deixa para mim só a decisão, em poucos toques pelo Telegram.

| Quando | O que acontece | Quem faz |
|---|---|---|
| Durante o dia | Vejo um post bom e mando o link para o bot | Eu (2 segundos) |
| **Todo dia, 18h** | O bot manda uma sugestão de comentário para cada post salvo, no meu tom | Claude |
| | Aprovo, peço outra versão, edito ou pulo; depois colo no LinkedIn | Eu |
| **Sexta** *(fase 3)* | Carrossel em PDF sobre um tema, publicado pela API oficial após minha aprovação | Claude + API do LinkedIn |
| **Sábado** *(fase 4)* | Lista de recrutadores da minha área com notas de conexão prontas | Claude + busca pública |
| **Domingo** *(fase 2)* | Resumo da semana e dashboard das ações | Bot |

Nada é publicado ou enviado no LinkedIn sem eu ver antes. Isso respeita os termos da plataforma, protege a conta e garante que nada sai com o meu nome sem revisão.

## Como usar o bot

1. No app do LinkedIn, toque em **Compartilhar → Enviar** num post e mande o link para o bot. Se quiser, cole o texto do post junto.
2. Se o LinkedIn não deixar ler o post pelo link, o bot pede o texto.
3. Às 18h chegam as sugestões, cada uma com **✅ Aprovar · 🔄 Outra versão · ✏️ Editar · ❌ Pular**.
4. Ao aprovar, o comentário vem pronto para copiar (é só tocar no texto). Depois de colar no LinkedIn, toque em **✔️ Já comentei** para contar no resumo.

| Comando | O que faz |
|---|---|
| `/agora` | Gera as sugestões na hora, sem esperar as 18h |
| `/fila` | Mostra os posts salvos e em que etapa cada um está |
| `/semana` | Resumo das ações dos últimos 7 dias |
| `/ajuda` | Explica como usar |

---

## Como funciona por dentro

### O caminho de uma mensagem

```mermaid
sequenceDiagram
    actor Eu
    participant TG as Telegram
    participant W as Cloudflare Worker
    participant DB as D1
    participant LI as linkedin.com
    participant C as Claude API

    Eu->>TG: link do post
    TG->>W: webhook (com senha)
    W->>LI: lê a prévia pública
    W->>DB: salva post (aguardando 18h)
    W->>TG: "Post salvo ✔"

    Note over W: Cron 21:00 UTC (18h Brasília)
    W->>DB: até 5 posts da fila
    W->>C: rascunho no meu tom
    W->>TG: sugestão + botões
    Eu->>TG: ✅ Aprovar
    TG->>W: webhook (callback)
    W->>DB: status = aprovado
    W->>TG: comentário pronto para copiar
```

### Arquitetura

```mermaid
flowchart LR
    U[Eu no Telegram] -- link do post / botões --> TG[Telegram Bot API]
    TG -- webhook --> W[Cloudflare Worker]
    W -- mensagens e botões --> TG
    C[Cron 18h] --> W
    W -- rascunho do comentário --> A[Claude API]
    W -- prévia pública do post --> L[linkedin.com]
    W <--> D[(Cloudflare D1)]
    GH[GitHub Actions] -- testes + deploy --> W
```

### Stack e por que cada peça

| Peça | Papel | Por que ela | Alternativa descartada |
|---|---|---|---|
| **Telegram Bot API** | Interface: receber links e mostrar botões | Grátis, pronto em 2 minutos, botões nativos, webhook instantâneo | WhatsApp: a API oficial exige conta Business, um número separado e modelos aprovados, e cobra por conversa; as bibliotecas não oficiais arriscam banir o número |
| **Cloudflare Workers** | Onde o código roda | Serverless e sempre no ar: responde ao webhook em milissegundos. Tem horários agendados (Cron Triggers) e o plano grátis cobra esse uso com folga | GitHub Actions: só roda em horários marcados, então os botões demorariam minutos. VPS: custa e exige manutenção |
| **Cloudflare D1** | Banco de dados (SQLite) | SQL de verdade para consultas como "posts pendentes em ordem" e "ações por tipo na semana"; fica na mesma conta e de graça | KV: só chave e valor, sem consultas |
| **Claude API** | Escreve os rascunhos | Escrita natural em português e inglês, seguindo um perfil de tom | — |
| **TypeScript** | Linguagem | Tipos pegam erros antes do deploy (ex.: um status de post que não existe) | JavaScript puro |
| **Wrangler** | CLI da Cloudflare | Publica o Worker, aplica migrações e grava segredos; o `wrangler.toml` descreve tudo em texto | Configurar à mão no painel |
| **GitHub Actions** | CI e deploy | Testa cada pull request e publica cada push na `main`, sem instalar nada no computador | Deploy manual |
| **Vitest** | Testes | Rápido, roda TypeScript direto; 25 testes em menos de 1 segundo | Jest |

### Técnicas de engenharia

**Automação com aprovação humana (*human-in-the-loop*).** O sistema prepara, eu decido. É o que torna o projeto viável dentro das regras do LinkedIn.

**Injeção de dependências (portas e adaptadores).** A lógica em [`src/bot.ts`](src/bot.ts) não conhece Telegram, D1 nem Claude: só as interfaces `Messenger`, `Store` e `Drafter`, definidas em [`src/types.ts`](src/types.ts). O [`src/index.ts`](src/index.ts) liga cada interface à implementação real. Isso traz duas vantagens:
- nos testes entram versões falsas ([`test/fakes.ts`](test/fakes.ts)), então nada depende de rede;
- trocar o Telegram pelo WhatsApp é escrever um novo `Messenger`, sem mexer na lógica.

**Máquina de estados.** Cada post passa por estados bem definidos, e cada botão só faz uma transição válida:

```
falta o texto → aguardando 18h → sugestão enviada → aprovado → comentado
                                                  ↘ pulado
```

**Estado da conversa.** Quando o bot pede "cole o texto" ou "mande a sua versão", ele grava no banco o que está esperando (`awaiting`), e a próxima mensagem é interpretada nesse contexto. Mandar um link novo ou um comando cancela a espera.

**Webhook com `waitUntil`.** O Worker responde "ok" ao Telegram na hora e termina o trabalho em segundo plano. Sem isso, uma chamada demorada ao Claude faria o Telegram achar que a mensagem falhou e reenviá-la, gerando duplicatas.

**Engenharia de prompt.** O prompt de sistema é montado a partir de [`src/perfil.ts`](src/perfil.ts): quem eu sou, objetivo, tom, regras (2 a 4 frases, sem elogio vazio, sem hashtags, sem inventar experiência, no idioma do post) e exemplos meus. Mudar o tom é editar esse arquivo.
- O post vai entre tags `<post>`, separando o conteúdo das instruções. Um post que diga "ignore as regras" é tratado como texto, não como ordem.
- Em "Outra versão", o rascunho anterior vai junto com o pedido de um ângulo diferente.

**Resiliência na API do Claude.** `fallbacks: "default"` faz a própria API tentar de novo em outro modelo se houver uma recusa por falso positivo. Se mesmo assim vier recusa (`stop_reason: "refusal"`), o bot avisa em vez de mandar um comentário vazio.

**Degradação graciosa na leitura do LinkedIn.** Quando só o link é enviado, a leitura tenta, em ordem:
1. JSON-LD (dados estruturados da página, que costumam trazer o texto completo e o autor);
2. metatags Open Graph (texto mais curto);
3. pedir o texto para mim.

O bot nunca trava por causa do LinkedIn.

**Segurança.**
- *Webhook autenticado:* o Telegram envia uma senha em cada chamada, e o Worker recusa as que não a têm. A senha é derivada do token do bot com SHA-256, então não há mais um segredo para gerenciar.
- *Bot com dono:* o primeiro `/start` grava o meu chat; outras pessoas recebem "bot pessoal" e os botões delas são ignorados.
- *Segredos fora do código:* as chaves ficam nos Secrets do GitHub e dentro do Worker, nunca no repositório. Por isso ele pode ser público.
- *Escape de HTML:* `<`, `>` e `&` vindos do post ou do comentário são convertidos antes de ir ao Telegram, evitando mensagens quebradas e injeção de formatação.

**Idempotência.** Tocar duas vezes em "✔️ Já comentei" registra uma ação só. Os números do resumo ficam confiáveis.

**Isolamento de erros.** Na rodada das 18h, uma falha num post gera um aviso sobre aquele post e os demais seguem.

**Controle de custo.** No máximo 5 sugestões por dia: segura o gasto com a API e mantém a rotina realista.

**Infraestrutura como código.** Worker, banco, tabelas ([`migrations/`](migrations)) e horários estão descritos no repositório. O script [`scripts/ensure-d1.mjs`](scripts/ensure-d1.mjs) só cria o banco se ele não existir, então o deploy pode rodar quantas vezes for preciso. As migrações numeradas evoluem o banco sem perder dados.

**Fuso horário.** Cron Triggers usam UTC: `0 21 * * *` = 18:00 em Brasília, que não tem horário de verão desde 2019.

### Estrutura do código

| Arquivo | O que faz |
|---|---|
| [`src/index.ts`](src/index.ts) | Entrada do Worker: rota do webhook, rota de setup e o cron |
| [`src/bot.ts`](src/bot.ts) | Toda a lógica: mensagens, botões, rodada das 18h |
| [`src/types.ts`](src/types.ts) | Tipos e interfaces (`Store`, `Messenger`, `Drafter`) |
| [`src/perfil.ts`](src/perfil.ts) | Meu tom, regras, exemplos e perfis que acompanho |
| [`src/claude.ts`](src/claude.ts) | Prompt e chamada à Claude API |
| [`src/linkedin.ts`](src/linkedin.ts) | Extrair o link e ler a prévia pública do post |
| [`src/telegram.ts`](src/telegram.ts) | Cliente da Bot API e senha do webhook |
| [`src/store.ts`](src/store.ts) | Acesso ao D1 |
| [`migrations/`](migrations) | Estrutura do banco |
| [`test/`](test) | Testes e implementações falsas |
| [`.github/workflows/`](.github/workflows) | CI e deploy |

### Custos

| Serviço | Custo mensal |
|---|---|
| Cloudflare Workers + D1 | Grátis (plano Free) |
| Telegram | Grátis |
| GitHub Actions | Grátis (repositório público) |
| Claude API | Poucos dólares em créditos pré-pagos, conforme o modelo |

---

## Configuração (uma vez)

### 1. Criar as chaves

| Segredo | Onde conseguir |
|---|---|
| `TELEGRAM_BOT_TOKEN` | No Telegram, fale com [@BotFather](https://t.me/BotFather) → `/newbot`. O token vem na mensagem final (formato `números:letras`) |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com): compre créditos (sem recarga automática) e crie a chave em API Keys |
| `CLOUDFLARE_API_TOKEN` | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token → modelo **Edit Cloudflare Workers** + linha extra **Account → D1 → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | O código de 32 caracteres na URL do painel (`dash.cloudflare.com/<account_id>/home`) |

### 2. Ativar o subdomínio `workers.dev`

No painel da Cloudflare, em **Workers & Pages**, registre um subdomínio (ex.: `seunome.workers.dev`). Sem isso o primeiro deploy falha.

### 3. Cadastrar no GitHub

Em **Settings → Secrets and variables → Actions → New repository secret**, crie os quatro segredos com esses nomes exatos.

### 4. Publicar

Faça um push na `main` (ou rode o workflow **Deploy** em Actions). Ele:
1. roda typecheck e testes;
2. confere os segredos;
3. cria o banco D1, se ainda não existir, e aplica as migrações;
4. publica o Worker e grava os segredos nele;
5. registra o webhook e os comandos do Telegram.

### 5. Começar

Abra o bot no Telegram e mande `/start`. O primeiro chat que mandar `/start` vira o dono.

## Desenvolvimento

```bash
npm install
npm test          # testes (sem rede)
npm run typecheck
```

## Roadmap

- [x] **Fase 1**: salvar posts pelo Telegram, sugestões às 18h, aprovar/editar/pular, registro de comentários
- [ ] **Fase 2**: resumo de domingo, registro do SSI semanal e dashboard público das ações
- [ ] **Fase 3**: carrossel de sexta (slides → PDF) publicado pela API oficial do LinkedIn
- [ ] **Fase 4**: lista de sábado com 50 recrutadores da área e notas de conexão

## Licença

MIT
