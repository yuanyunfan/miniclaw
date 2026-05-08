import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyConnectivity,
  runConnectivityTick,
  type ConnectivityCheckers,
  type ConnectivityChecks,
  type ProbeResult,
} from "../connectivity-core.js";

let tmp: string;
let statePath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-connectivity-"));
  statePath = join(tmp, "connectivity.json");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const ok = (): ProbeResult => ({ ok: true, latency_ms: 10 });
const fail = (error = "boom"): ProbeResult => ({ ok: false, latency_ms: 10, error });
const skipped = (): ProbeResult => ({ ok: false, skipped: true, error: "not configured" });

function checks(overrides: Partial<ConnectivityChecks> = {}): ConnectivityChecks {
  return {
    discord_gateway: ok(),
    discord_rest: ok(),
    general_network: ok(),
    smtp: ok(),
    ...overrides,
  };
}

function checkers(result: ConnectivityChecks): ConnectivityCheckers {
  return {
    discordGateway: async () => result.discord_gateway,
    discordRest: async () => result.discord_rest,
    generalNetwork: async () => result.general_network,
    smtp: async () => result.smtp,
  };
}

describe("connectivity core", () => {
  it("classifies Discord outage with general network and SMTP OK as VPN/proxy suspected", () => {
    expect(classifyConnectivity(checks({ discord_rest: fail("discord timeout") }))).toBe("vpn_or_proxy_suspected");
  });

  it("classifies SMTP outage even when Discord is healthy", () => {
    expect(classifyConnectivity(checks({ smtp: fail("smtp timeout") }))).toBe("smtp_unreachable");
  });

  it("sends one outage email after threshold and does not repeat during same outage", async () => {
    const sent: string[] = [];
    const outage = checks({ discord_rest: fail("discord timeout") });

    for (let i = 0; i < 4; i++) {
      await runConnectivityTick({
        statePath,
        failureThreshold: 3,
        checkers: checkers(outage),
        sendEmail: async (message) => {
          sent.push(message.subject);
        },
        now: () => new Date(Date.UTC(2026, 4, 8, 10, i)),
      });
    }

    expect(sent).toEqual(["MiniClaw Discord 链路中断"]);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.status).toBe("vpn_or_proxy_suspected");
    expect(state.consecutive_failures).toBe(4);
    expect(state.last_alert_at).toBeTruthy();
  });

  it("sends recovery email after an alerted outage recovers", async () => {
    const sent: string[] = [];
    const outage = checks({ discord_rest: fail("discord timeout") });

    await runConnectivityTick({
      statePath,
      failureThreshold: 1,
      checkers: checkers(outage),
      sendEmail: async (message) => {
        sent.push(message.subject);
      },
      now: () => new Date("2026-05-08T10:00:00.000Z"),
    });
    const recovered = await runConnectivityTick({
      statePath,
      failureThreshold: 1,
      checkers: checkers(checks()),
      sendEmail: async (message) => {
        sent.push(message.subject);
      },
      now: () => new Date("2026-05-08T10:14:00.000Z"),
    });

    expect(sent).toEqual(["MiniClaw Discord 链路中断", "MiniClaw Discord 链路已恢复"]);
    expect(recovered.status).toBe("recovered");
    expect(recovered.consecutive_failures).toBe(0);
    expect(recovered.last_outage_started_at).toBe("2026-05-08T10:00:00.000Z");
  });

  it("does not email when SMTP is skipped", async () => {
    const sent: string[] = [];
    const snapshot = await runConnectivityTick({
      statePath,
      failureThreshold: 1,
      checkers: checkers(checks({ discord_rest: fail("discord timeout"), smtp: skipped() })),
      sendEmail: async (message) => {
        sent.push(message.subject);
      },
      now: () => new Date("2026-05-08T10:00:00.000Z"),
    });

    expect(snapshot.status).toBe("discord_unreachable");
    expect(sent).toEqual([]);
  });
});
