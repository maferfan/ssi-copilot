import type { Recruiter } from "./types";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const STYLE = `
  :root { --ink:#0d0d0e; --surface:#141416; --line:rgba(236,231,222,.1); --bone:#ece7de; --dim:rgba(236,231,222,.62); --mute:rgba(236,231,222,.38); --accent:#d6ac72; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--ink); color:var(--bone); font:16px/1.5 "Manrope",system-ui,sans-serif; padding:40px 16px 64px; }
  main { max-width:820px; margin:0 auto; display:grid; gap:24px; }
  h1 { font:400 clamp(34px,6vw,52px)/1.1 "Instrument Serif",Georgia,serif; }
  h1 em { color:var(--accent); }
  .lead, .muted { color:var(--dim); }
  .mono { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:13px; color:var(--mute); }
  .actions { display:flex; flex-wrap:wrap; gap:12px; }
  button, .btn { font:600 15px "Manrope",system-ui,sans-serif; border-radius:10px; padding:12px 18px; cursor:pointer; border:1px solid var(--line); background:var(--surface); color:var(--bone); text-decoration:none; }
  button.primary { background:var(--accent); color:var(--ink); border-color:var(--accent); }
  button:focus-visible, a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .notice { display:none; border:1px solid var(--accent); border-radius:10px; padding:14px 16px; color:var(--bone); }
  .notice.show { display:block; }
  ol { list-style:none; display:grid; gap:10px; }
  li { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:14px 16px; display:grid; gap:6px; }
  li.opened { opacity:.55; }
  .row { display:flex; gap:12px; align-items:baseline; justify-content:space-between; flex-wrap:wrap; }
  .who a { color:var(--bone); font-weight:600; text-decoration-color:var(--accent); text-underline-offset:3px; }
  .num { font-family:"JetBrains Mono",monospace; color:var(--mute); margin-right:8px; }
  .headline { color:var(--dim); font-size:14px; }
  .note { display:flex; gap:10px; align-items:flex-start; background:var(--ink); border-radius:8px; padding:10px 12px; font-size:14px; }
  .note p { flex:1; }
  .note button { padding:6px 10px; font-size:13px; }
  .state { font-family:"JetBrains Mono",monospace; font-size:12px; color:var(--accent); }
  form { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400&family=Manrope:wght@400;600&display=swap" rel="stylesheet">
<style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/** Página de um bloco: abre os perfis em abas, copia a nota e registra o envio. */
export function invitesPageHtml(rows: Recruiter[], week: string, batch: number, token: string): string {
  const done = rows.length > 0 && rows.every((r) => r.status === "invited");
  const profiles = rows.map((r) => ({ id: r.id, url: r.url, note: r.note ?? "" }));
  const items = rows
    .map(
      (r, i) => `
    <li data-id="${r.id}">
      <div class="row">
        <span class="who"><span class="num">${String(i + 1).padStart(2, "0")}</span><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" data-open="${r.id}">${esc(r.name)}</a> ${r.language === "pt" ? "🇧🇷" : "🌎"}</span>
        <span class="state" data-state="${r.id}"></span>
      </div>
      ${r.headline ? `<span class="headline">${esc(r.headline)}</span>` : ""}
      ${r.note ? `<div class="note"><p>${esc(r.note)}</p><button type="button" data-copy="${r.id}">Copiar nota</button></div>` : ""}
    </li>`,
    )
    .join("");

  return shell(
    `Convites · bloco ${batch}`,
    `
  <header>
    <p class="mono">SSI Copilot · semana de ${week.slice(8, 10)}/${week.slice(5, 7)} · bloco ${batch}</p>
    <h1>${rows.length} recrutadores, <em>um clique</em></h1>
    <p class="lead">Abra os perfis, clique em <b>Conectar</b> em cada aba e feche. Nos perfis com nota, escolha <b>Adicionar nota</b> e cole.</p>
  </header>

  <div class="actions">
    <button class="primary" type="button" id="all">Abrir os ${rows.length} em abas</button>
    <button type="button" id="next">Abrir o próximo</button>
  </div>
  <p class="notice" id="blocked" role="status">O navegador bloqueou as abas. Clique no ícone de pop-up bloqueado na barra de endereço, escolha <b>Sempre permitir</b> para este site e clique de novo. Enquanto isso, use <b>Abrir o próximo</b>.</p>

  <ol>${items}</ol>

  <form method="post" action="/convites">
    <input type="hidden" name="w" value="${esc(week)}"><input type="hidden" name="b" value="${batch}"><input type="hidden" name="t" value="${esc(token)}">
    ${done ? `<p class="muted">✔️ Este bloco já foi registrado.</p>` : `<button class="primary" type="submit">✔️ Enviei estes ${rows.length}</button><span class="muted">Conta os convites no resumo e no painel.</span>`}
  </form>

<script>
  const profiles = ${JSON.stringify(profiles).replace(/</g, "\\u003c")};
  const key = "convites:${esc(week)}:${batch}";
  let opened = [];
  try { opened = JSON.parse(localStorage.getItem(key) || "[]"); } catch {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(opened)); } catch {} };
  const mark = (id) => {
    if (!opened.includes(id)) opened.push(id);
    save();
    document.querySelector('li[data-id="' + id + '"]')?.classList.add("opened");
    const s = document.querySelector('[data-state="' + id + '"]');
    if (s) s.textContent = "aberto";
  };
  opened.forEach(mark);

  const copy = async (text) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };
  const open = (p) => {
    const w = window.open(p.url, "_blank");
    if (!w) return false;
    try { w.opener = null; } catch {}
    mark(p.id);
    return true;
  };

  document.getElementById("all").addEventListener("click", () => {
    let blocked = 0;
    for (const p of profiles) if (!open(p)) blocked++;
    document.getElementById("blocked").classList.toggle("show", blocked > 0);
  });
  document.getElementById("next").addEventListener("click", async () => {
    const p = profiles.find((x) => !opened.includes(x.id));
    if (!p) return;
    if (p.note) await copy(p.note);
    if (!open(p)) location.href = p.url;
  });
  document.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", () => mark(Number(a.dataset.open))));
  document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
    const p = profiles.find((x) => x.id === Number(b.dataset.copy));
    if (p && await copy(p.note)) { b.textContent = "Copiada ✓"; setTimeout(() => (b.textContent = "Copiar nota"), 1500); }
  }));
</script>`,
  );
}

export function messagePageHtml(title: string, text: string): string {
  return shell(title, `<h1>${esc(title)}</h1><p class="lead">${esc(text)}</p>`);
}
