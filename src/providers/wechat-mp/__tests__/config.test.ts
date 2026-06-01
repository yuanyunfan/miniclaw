import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadWechatMpProviderConfig } from "../config.js";

let tmp: string;
let previousConfigDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-wechat-config-"));
  previousConfigDir = process.env.MINICLAW_WECHAT_MP_CONFIG_DIR;
  process.env.MINICLAW_WECHAT_MP_CONFIG_DIR = tmp;
});

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.MINICLAW_WECHAT_MP_CONFIG_DIR;
  } else {
    process.env.MINICLAW_WECHAT_MP_CONFIG_DIR = previousConfigDir;
  }
  rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(name: string, yaml: string): void {
  writeFileSync(join(tmp, `${name}.yaml`), yaml);
}

describe("loadWechatMpProviderConfig", () => {
  it("keeps relative window_hours behavior by default", () => {
    writeConfig("relative", `
window_hours: 24
accounts:
  - name: 机器之心
    query: 机器之心
`);

    const config = loadWechatMpProviderConfig("relative");

    expect(config.window).toEqual({ mode: "relative", hours: 24 });
    expect(config.browser_profile_dir).toBe("~/.miniclaw/browser-profiles/wechat-mp");
    expect(config.read_filter).toMatchObject({ enabled: false, min_title_score: 55 });
  });

  it("parses fixed slot windows", () => {
    writeConfig("fixed", `
window:
  mode: fixed_slots
  timezone_offset_hours: 8
  slots:
    - at_hour: 10
      start_day_offset: -1
      start_hour: 17
      end_day_offset: 0
      end_hour: 10
    - at_hour: 17
      start_day_offset: 0
      start_hour: 10
      end_day_offset: 0
      end_hour: 17
max_pages_per_account: 5
page_size: 10
dedupe: true
read_filter:
  enabled: true
  min_title_score: 60
  max_articles_to_fetch: 4
  excerpt_chars: 1800
  fetch_timeout_ms: 12000
browser_profile_dir: ~/.miniclaw/browser-profiles/wechat-mp-daily
accounts:
  - name: 机器之心
    query: 机器之心
`);

    const config = loadWechatMpProviderConfig("fixed");

    expect(config.max_pages_per_account).toBe(5);
    expect(config.browser_profile_dir).toBe("~/.miniclaw/browser-profiles/wechat-mp-daily");
    expect(config.window).toMatchObject({
      mode: "fixed_slots",
      timezone_offset_hours: 8,
      slots: [
        { at_hour: 10, start_day_offset: -1, start_hour: 17, end_day_offset: 0, end_hour: 10 },
        { at_hour: 17, start_day_offset: 0, start_hour: 10, end_day_offset: 0, end_hour: 17 },
      ],
    });
    expect(config.read_filter).toEqual({
      enabled: true,
      min_title_score: 60,
      max_articles_to_fetch: 4,
      excerpt_chars: 1800,
      fetch_timeout_ms: 12_000,
    });
  });

  it("rejects fixed slot windows without slots", () => {
    writeConfig("bad", `
window:
  mode: fixed_slots
accounts:
  - name: 机器之心
    query: 机器之心
`);

    expect(() => loadWechatMpProviderConfig("bad")).toThrow(/requires slots/);
  });
});
