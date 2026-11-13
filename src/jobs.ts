import type { Perfil } from "./perfil";
import type { JobPosting } from "./types";

export const JOBS_PER_REGION = 5;
/** Mínimo de salário no Brasil (por mês). */
export const BR_MIN_SALARY = 10_000;
/** Quantos links de vagas já enviadas guardar para não repetir. */
export const SENT_MEMORY = 400;

/** Grupos e redes onde vaga circula sem anúncio oficial: ficam de fora. */
const GROUP_HOSTS = /(^|\.)(chat\.whatsapp\.com|wa\.me|t\.me|telegram\.me|facebook\.com|fb\.com|discord\.gg|discord\.com|instagram\.com|twitter\.com|x\.com)$/i;

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
- Only real, currently open listings posted in the last 30 days, from company career pages or job boards (LinkedIn Jobs, Gupy, Greenhouse, Lever, Ashby, Workable, Wellfound, Remotive, We Work Remotely, Himalayas, Programathor, Revelo, Trampos).
- Exclude: jobs shared in WhatsApp/Telegram/Facebook/Discord groups, social media posts, reposts on aggregator lists, "banco de talentos", internships, junior roles, and roles that clearly do not fit the stack.
- Front-end, full-stack or React/TypeScript/Node roles. Mid-level or senior.
- "url" must be copied exactly from a search result you got in this conversation (the listing page).
- "salario": exactly as the listing states it, or "não informado". "salario_ok": true only if the listing states a salary that meets the minimum (for "intl", true if a salary is stated).
- "motivo": in Brazilian Portuguese, one sentence on why it fits the candidate's CV.

Reply at the end with ONLY a JSON array, no text before or after:
[{"titulo": "...", "empresa": "...", "regiao": "br" | "intl", "local": "...", "salario": "...", "salario_ok": true, "motivo": "...", "url": "https://..."}]${skip}`;
}

function host(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Até 5 vagas por região: só links de sites que apareceram na busca, sem grupos/redes,
 * sem repetir as já enviadas; as que informam salário dentro do mínimo vêm primeiro.
 */
export function selectJobs(items: JobPosting[], seen: Set<string>, sent: string[], key: (url: string) => string | null): JobPosting[] {
  const seenHosts = new Set([...seen].map((k) => k.split("/")[0]));
  const sentSet = new Set(sent);
  const ok: JobPosting[] = [];
  for (const it of items) {
    const h = it?.url ? host(it.url) : null;
    const k = it?.url ? key(it.url) : null;
    if (!h || !k || GROUP_HOSTS.test(h) || !seenHosts.has(h) || sentSet.has(k)) continue;
    if (!it.titulo?.trim() || !it.empresa?.trim()) continue;
    if (ok.some((o) => key(o.url) === k || (o.titulo === it.titulo && o.empresa === it.empresa))) continue;
    ok.push({
      titulo: it.titulo.trim(),
      empresa: it.empresa.trim(),
      regiao: it.regiao === "intl" ? "intl" : "br",
      local: (it.local ?? "").trim(),
      salario: (it.salario ?? "").trim() || "não informado",
      salario_ok: Boolean(it.salario_ok),
      motivo: (it.motivo ?? "").trim(),
      url: it.url,
    });
  }
  const pick = (regiao: JobPosting["regiao"]) =>
    ok
      .filter((j) => j.regiao === regiao)
      .sort((a, b) => Number(b.salario_ok) - Number(a.salario_ok))
      .slice(0, JOBS_PER_REGION);
  return [...pick("br"), ...pick("intl")];
}
