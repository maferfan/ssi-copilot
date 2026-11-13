import type { Perfil } from "./perfil";
import type { JobPosting } from "./types";

export const JOBS_PER_REGION = 5;
/** Mínimo de salário no Brasil (por mês). */
export const BR_MIN_SALARY = 10_000;
/** Quantos links de vagas já enviadas guardar para não repetir. */
export const SENT_MEMORY = 400;

/** Grupos e redes onde vaga circula sem anúncio oficial: ficam de fora. */
const GROUP_HOSTS = /(^|\.)(chat\.whatsapp\.com|wa\.me|t\.me|telegram\.me|facebook\.com|fb\.com|discord\.gg|discord\.com|instagram\.com|twitter\.com|x\.com)$/i;

/**
 * Plataformas de massa, onde a candidatura raramente vira entrevista (pedido do usuário):
 * Gupy e agregadores/sites de vagas genéricos. Ficam só a página de carreira da empresa
 * (inclusive o sistema de recrutamento dela, como Greenhouse ou Lever) e o LinkedIn.
 */
const MASS_HOSTS =
  /(^|\.)(gupy\.io|gupy\.com\.br|programathor\.com\.br|revelo\.com\.br|revelo\.com|trampos\.co|vagas\.com\.br|infojobs\.com\.br|catho\.com\.br|indeed\.com|indeed\.com\.br|glassdoor\.com|glassdoor\.com\.br|remotive\.com|weworkremotely\.com|himalayas\.app|wellfound\.com|remoteok\.com|jooble\.org|talent\.com|bne\.com\.br|empregos\.com\.br|solides\.jobs|99jobs\.com|kenoby\.com|jobs\.solides\.com\.br)$/i;

/** O link é de onde a candidatura chega direto: site/ATS da empresa ou LinkedIn. */
export function isDirectListing(url: string): boolean {
  const h = host(url);
  return Boolean(h && !GROUP_HOSTS.test(h) && !MASS_HOSTS.test(h));
}

export function jobsPrompt(p: Perfil, today: Date, exclude: string[]): string {
  const cv = p.curriculo;
  const skip = exclude.length ? `\n\nAlready sent before (do not repeat):\n${exclude.slice(-150).join("\n")}` : "";
  return `Today is ${today.toISOString().slice(0, 10)}. Find open software engineering jobs for this candidate:

- Role: ${cv.cargo}
- Experience: ${cv.experiencia}
- Stack: ${cv.stack.join(", ")}
- Highlights: ${cv.destaques.join("; ")}
- Languages: ${cv.idiomas}
- Location: ${cv.local}

Search for two groups, ${JOBS_PER_REGION} or more candidates each (the code picks the best ${JOBS_PER_REGION}):
1. "br": jobs in Brazil (remote preferred, or hybrid in Santa Catarina) paying at least R$ ${BR_MIN_SALARY.toLocaleString("pt-BR")} per month (CLT or PJ). Prefer listings that state the salary.
2. "intl": remote jobs at companies outside Brazil that hire people living in Brazil or LATAM (contractor or employer of record).

Rules:
- Only real listings that are still open (accepting applications), posted in the last 21 days; prefer the last 7 days, when fewer people have applied.
- Only where the application goes straight to the company: the company's own careers page (including its applicant tracking system, e.g. Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Teamtailor) or LinkedIn Jobs.
- Exclude: Gupy, Catho, InfoJobs, Vagas.com, Indeed, Glassdoor, Programathor, Revelo, Trampos, Remotive, We Work Remotely, Himalayas, Wellfound and other job aggregators; jobs shared in WhatsApp/Telegram/Facebook/Discord groups; social media posts; "banco de talentos"; internships; junior roles; roles that clearly do not fit the stack.
- Prefer roles where the CV is a strong match (most required skills present), so the candidate has a real chance of getting an interview.
- Front-end, full-stack or React/TypeScript/Node roles. Mid-level or senior.
- "url" must be copied exactly from a search result you got in this conversation (the listing page).
- "salario": exactly as the listing states it, or "não informado". "salario_ok": true only if the listing states a salary that meets the minimum (for "intl", true if a salary is stated).
- "motivo": in Brazilian Portuguese, one sentence on why it fits the candidate's CV.
- "aderencia": 0 to 100, how well the CV matches the listed requirements.

Reply at the end with ONLY a JSON array, no text before or after:
[{"titulo": "...", "empresa": "...", "regiao": "br" | "intl", "local": "...", "salario": "...", "salario_ok": true, "aderencia": 85, "motivo": "...", "url": "https://..."}]${skip}`;
}

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Até 5 vagas por região: só links de sites que apareceram na busca e que levam direto à
 * empresa (sem Gupy, agregadores, grupos ou redes), sem repetir as já enviadas; primeiro as
 * que informam salário dentro do mínimo, depois as de maior aderência ao currículo.
 */
export function selectJobs(items: JobPosting[], seen: Set<string>, sent: string[], key: (url: string) => string | null): JobPosting[] {
  const seenHosts = new Set([...seen].map((k) => k.split("/")[0]));
  const sentSet = new Set(sent);
  const ok: JobPosting[] = [];
  for (const it of items) {
    const h = it?.url ? host(it.url) : null;
    const k = it?.url ? key(it.url) : null;
    if (!h || !k || !isDirectListing(it.url) || !seenHosts.has(h) || sentSet.has(k)) continue;
    if (!it.titulo?.trim() || !it.empresa?.trim()) continue;
    if (ok.some((o) => key(o.url) === k || (o.titulo === it.titulo && o.empresa === it.empresa))) continue;
    ok.push({
      titulo: it.titulo.trim(),
      empresa: it.empresa.trim(),
      regiao: it.regiao === "intl" ? "intl" : "br",
      local: (it.local ?? "").trim(),
      salario: (it.salario ?? "").trim() || "não informado",
      salario_ok: Boolean(it.salario_ok),
      aderencia: Math.max(0, Math.min(100, Math.round(Number(it.aderencia) || 0))),
      motivo: (it.motivo ?? "").trim(),
      url: it.url,
    });
  }
  const pick = (regiao: JobPosting["regiao"]) =>
    ok
      .filter((j) => j.regiao === regiao)
      .sort((a, b) => Number(b.salario_ok) - Number(a.salario_ok) || (b.aderencia ?? 0) - (a.aderencia ?? 0))
      .slice(0, JOBS_PER_REGION);
  return [...pick("br"), ...pick("intl")];
}
