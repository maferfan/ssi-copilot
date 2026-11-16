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

describe("publicação do carrossel", () => {
  it("o cron de publicação é o mesmo dia e hora que o bot mostra (Brasília = UTC-3)", async () => {
    const { PUBLISH_WEEKDAYS, PUBLISH_MINUTES } = await import("../src/bot");
    const [min, hour, , , dow] = CRONS.publish.split(" ");
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    expect(dow.split(",").map((d) => days.indexOf(d)).sort()).toEqual(Object.values(PUBLISH_WEEKDAYS).sort());
    expect((Number(hour) - 3) * 60 + Number(min)).toBe(PUBLISH_MINUTES);
  });
});
