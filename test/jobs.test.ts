import { describe, expect, it } from "vitest";
import { Bot } from "../src/bot";
import { urlKey } from "../src/claude";
import { isDirectListing, jobsPrompt, selectJobs } from "../src/jobs";
import { perfil } from "../src/perfil";
import { job, makeDeps, msg } from "./fakes";

async function setup() {
  const ctx = makeDeps({ now: () => new Date("2026-11-14T13:00:00Z") });
  const bot = new Bot(ctx.deps, perfil);
  await bot.handleUpdate(msg("/start"));
  return { ...ctx, bot };
}

const SEEN = new Set(["linkedin.com/jobs/view/100", "boards.greenhouse.io/x"]);

describe("selectJobs", () => {
  it("5 por região, com salário dentro do mínimo primeiro", () => {
    const items = [
      job({ titulo: "Sem salário", salario: "não informado", salario_ok: false, url: "https://www.linkedin.com/jobs/view/10a" }),
      ...Array.from({ length: 5 }, (_, i) => job({ titulo: `BR ${i}`, url: `https://www.linkedin.com/jobs/view/10b${i}` })),
      ...Array.from({ length: 6 }, (_, i) => job({ titulo: `Intl ${i}`, regiao: "intl", url: `https://boards.greenhouse.io/x/${i}` })),
    ];
    const out = selectJobs(items, SEEN, [], urlKey);
    expect(out.filter((j) => j.regiao === "br").map((j) => j.titulo)).toEqual(["BR 0", "BR 1", "BR 2", "BR 3", "BR 4"]);
    expect(out.filter((j) => j.regiao === "intl")).toHaveLength(5);
  });

  it("tira grupos e redes, sites que não apareceram na busca, repetidas e já enviadas", () => {
    const out = selectJobs(
      [
        job({ titulo: "Grupo", url: "https://chat.whatsapp.com/abc" }),
        job({ titulo: "Telegram", url: "https://t.me/vagasdev/123" }),
        job({ titulo: "Facebook", url: "https://www.facebook.com/groups/devs/posts/1" }),
        job({ titulo: "Inventada", url: "https://inventada.example/vaga" }),
        job({ titulo: "Já enviada", url: "https://www.linkedin.com/jobs/view/10old" }),
        job({ titulo: "Boa", url: "https://www.linkedin.com/jobs/view/10new" }),
        job({ titulo: "Boa", url: "https://www.linkedin.com/jobs/view/10new/" }),
      ],
      SEEN,
      ["linkedin.com/jobs/view/10old"],
      urlKey,
    );
    expect(out.map((j) => j.titulo)).toEqual(["Boa"]);
  });

  it("só candidatura direta: tira Gupy e agregadores; aceita LinkedIn e página/ATS da empresa", () => {
    const seen = new Set(["gupy.io", "acme.gupy.io/x", "programathor.com.br/x", "remotive.com/x", "linkedin.com/jobs/view/1", "careers.acme.com/x", "jobs.lever.co/acme", "boards.greenhouse.io/x"]);
    const out = selectJobs(
      [
        job({ titulo: "Gupy", url: "https://acme.gupy.io/jobs/9" }),
        job({ titulo: "Programathor", url: "https://programathor.com.br/jobs/9" }),
        job({ titulo: "Remotive", regiao: "intl", url: "https://remotive.com/remote-jobs/9" }),
        job({ titulo: "LinkedIn", url: "https://www.linkedin.com/jobs/view/1" }),
        job({ titulo: "Site da empresa", url: "https://careers.acme.com/jobs/9" }),
        job({ titulo: "Lever", regiao: "intl", url: "https://jobs.lever.co/acme/9" }),
      ],
      seen,
      [],
      urlKey,
    );
    expect(out.map((j) => j.titulo)).toEqual(["LinkedIn", "Site da empresa", "Lever"]);
    expect(isDirectListing("https://empresa.gupy.io/jobs/1")).toBe(false);
  });

  it("entre as com salário dentro do mínimo, maior aderência ao currículo primeiro", () => {
    const seen = new Set(["linkedin.com/jobs/view/1"]);
    const out = selectJobs(
      [
        job({ titulo: "Baixa", aderencia: 40, url: "https://www.linkedin.com/jobs/view/1" }),
        job({ titulo: "Alta", aderencia: 92, url: "https://www.linkedin.com/jobs/view/2" }),
        job({ titulo: "Sem salário", aderencia: 99, salario_ok: false, url: "https://www.linkedin.com/jobs/view/3" }),
      ],
      seen,
      [],
      urlKey,
    );
    expect(out.map((j) => j.titulo)).toEqual(["Alta", "Baixa", "Sem salário"]);
  });

  it("o pedido usa o currículo, as duas regiões e o mínimo de R$ 10 mil", () => {
    const p = jobsPrompt(perfil, new Date("2026-11-14T00:00:00Z"), ["linkedin.com/jobs/view/10old"]);
    expect(p).toContain("Engenheiro de Software Full Stack");
    expect(p).toContain("React, Next.js, TypeScript");
    expect(p).toContain("R$ 10.000 per month");
    expect(p).toContain("hire people living in Brazil or LATAM");
    expect(p).toContain("WhatsApp/Telegram/Facebook/Discord groups");
    expect(p).toContain("Exclude: Gupy");
    expect(p).toContain("still open");
    expect(p).toContain("linkedin.com/jobs/view/10old");
  });
});

describe("/vagas", () => {
  it("manda 5 do Brasil e 5 do exterior numa mensagem e guarda as enviadas", async () => {
    const { bot, messenger, store } = await setup();
    await bot.handleUpdate(msg("/vagas"));
    const html = messenger.last().html;
    expect(html).toContain("💼 <b>Vagas da semana</b>");
    expect(html).toContain("🇧🇷 <b>Brasil</b> (a partir de R$ 10.000)");
    expect(html).toContain("🌎 <b>Exterior</b>");
    expect(html.match(/<b>\d\. BR /g)).toHaveLength(5);
    expect(html.match(/<b>\d\. Intl /g)).toHaveLength(5);
    expect(html).not.toContain("BR 0</b>"); // sem salário dentro do mínimo, ficou para trás
    expect(JSON.parse((await store.getSetting("jobs_sent"))!)).toHaveLength(10);
  });

  it("na semana seguinte não repete e avisa quando falta vaga", async () => {
    const { bot, messenger, drafter } = await setup();
    await bot.handleUpdate(msg("/vagas"));
    await bot.handleUpdate(msg("/vagas"));
    expect(drafter.jobCalls[1]).toHaveLength(10);
    const html = messenger.last().html;
    expect(html.match(/<b>\d\. BR /g)).toHaveLength(1);
    expect(html).toContain("Só achei 1 desta vez");
  });

  it("vazio ou erro avisa", async () => {
    const ctx = await setup();
    ctx.drafter.jobResults = [];
    await ctx.bot.handleUpdate(msg("/vagas"));
    expect(ctx.messenger.last().html).toContain("Não achei vagas novas");
    ctx.deps.drafter.findJobs = async () => {
      throw new Error("rede");
    };
    await ctx.bot.handleUpdate(msg("/vagas"));
    expect(ctx.messenger.last().html).toContain("Não consegui buscar as vagas: rede");
  });

  it("no webhook vai para a fila", async () => {
    const ctx = await setup();
    ctx.deps.defer = (j) => ctx.store.enqueueJob(j);
    await ctx.bot.handleUpdate(msg("/vagas"));
    expect(ctx.store.jobs.map((j) => j.job.kind)).toEqual(["jobs"]);
    expect(ctx.drafter.jobCalls).toHaveLength(0);
  });
});
