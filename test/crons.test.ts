import { describe, expect, it } from "vitest";
import toml from "../wrangler.toml?raw";
import { CRONS } from "../src/crons";

describe("crons", () => {
  const configured = JSON.parse(toml.match(/^crons\s*=\s*(\[[^\]]*\])/m)![1]) as string[];

  it("wrangler.toml registra exatamente os horários que o Worker trata", () => {
    expect([...configured].sort()).toEqual(Object.values(CRONS).sort());
  });

  it("não usa 0 como domingo (a Cloudflare recusa; o certo é SUN)", () => {
    for (const cron of configured) expect(cron.split(" ")[4]).not.toBe("0");
  });
});
