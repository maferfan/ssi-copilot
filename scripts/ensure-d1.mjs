// Garante que o banco D1 existe e grava o id dele no wrangler.toml.
// Roda no deploy, para ninguém precisar criar o banco na mão.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NAME = "ssi-copilot";
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8" });

const list = JSON.parse(wrangler("d1", "list", "--json"));
let db = list.find((d) => d.name === NAME);
if (!db) {
  console.log(`Criando o banco D1 "${NAME}"...`);
  wrangler("d1", "create", NAME);
  db = JSON.parse(wrangler("d1", "list", "--json")).find((d) => d.name === NAME);
}
if (!db?.uuid) throw new Error("Não encontrei o id do banco D1");

const toml = readFileSync("wrangler.toml", "utf8").replace(/database_id = "[^"]*"/, `database_id = "${db.uuid}"`);
writeFileSync("wrangler.toml", toml);
console.log(`Banco D1 "${NAME}": ${db.uuid}`);
