import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Client } from "discord.js";
import { runScript } from "../runner-script.js";
import type { CronJobScript } from "../types.js";

let tmp: string;
let previousScriptsDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "miniclaw-runner-script-"));
  previousScriptsDir = process.env.MINICLAW_SCRIPTS_DIR;
  process.env.MINICLAW_SCRIPTS_DIR = tmp;
});

afterEach(() => {
  if (previousScriptsDir === undefined) delete process.env.MINICLAW_SCRIPTS_DIR;
  else process.env.MINICLAW_SCRIPTS_DIR = previousScriptsDir;
  rmSync(tmp, { recursive: true, force: true });
});

function writeScript(file: string, body: string): void {
  const path = join(tmp, file);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function scriptJob(overrides: Partial<CronJobScript>): CronJobScript {
  return {
    name: "test-script",
    schedule: "* * * * *",
    enabled: true,
    type: "script",
    channel: "1000000000000000000",
    script: "script.sh",
    capture_output: true,
    timeout_sec: 5,
    ...overrides,
  };
}

function fakeClient(sent: unknown[]): Client {
  return {
    channels: {
      fetch: async () => ({
        isSendable: () => true,
        send: async (payload: unknown) => {
          sent.push(payload);
          return {};
        },
      }),
    },
  } as unknown as Client;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runScript", () => {
  it("非零退出会发出失败消息并抛错，方便 scheduler 记录 error", async () => {
    writeScript("script.sh", `#!/usr/bin/env bash
echo "stdout line"
echo "stderr line" >&2
exit 7
`);
    const sent: unknown[] = [];

    await expect(runScript(scriptJob({}), fakeClient(sent))).rejects.toThrow(/script exited with code 7/);

    expect(sent).toHaveLength(1);
    const payload = sent[0] as { content: string };
    expect(payload.content).toContain("❌ exit=7");
    expect(payload.content).toContain("stdout line");
    expect(payload.content).toContain("stderr line");
  });

  it("超时会杀掉脚本启动的后台子进程", async () => {
    const marker = join(tmp, "orphan-marker");
    writeScript("script.sh", `#!/usr/bin/env bash
python3 -c 'import pathlib, time; time.sleep(2); pathlib.Path("${marker}").write_text("orphan")' &
wait
`);
    const sent: unknown[] = [];

    await expect(runScript(scriptJob({ timeout_sec: 1 }), fakeClient(sent))).rejects.toThrow(/timed out after 1s/);
    await sleep(2500);

    expect(sent).toHaveLength(1);
    const payload = sent[0] as { content: string };
    expect(payload.content).toContain("timeout(1s)");
    expect(existsSync(marker)).toBe(false);
  });

  it("DISCORD_MESSAGE 文件会作为正文发送，不再包外层 code block", async () => {
    writeScript("script.sh", `#!/usr/bin/env bash
set -euo pipefail
printf '**Backup Snapshot**\\n- Apps: 58\\n' > summary.md
printf '{"ok":true}\\n' > snapshot.json
echo "DISCORD_MESSAGE:$PWD/summary.md"
echo "MEDIA:$PWD/snapshot.json"
`);
    const sent: unknown[] = [];

    await runScript(scriptJob({}), fakeClient(sent));

    expect(sent).toHaveLength(1);
    const payload = sent[0] as { content: string; files: unknown[] };
    expect(payload.content).toContain("**Backup Snapshot**");
    expect(payload.content).toContain("- Apps: 58");
    expect(payload.content).not.toContain("cron `test-script`");
    expect(payload.content).not.toContain("```");
    expect(payload.files).toHaveLength(1);
  });

  it("多个 DISCORD_MESSAGE 会拆成多条消息，附件放在最后一条", async () => {
    writeScript("script.sh", `#!/usr/bin/env bash
set -euo pipefail
printf 'part one\\n' > one.md
printf 'part two\\n' > two.md
printf '{"ok":true}\\n' > snapshot.json
echo "DISCORD_MESSAGE:$PWD/one.md"
echo "DISCORD_MESSAGE:$PWD/two.md"
echo "MEDIA:$PWD/snapshot.json"
`);
    const sent: unknown[] = [];

    await runScript(scriptJob({}), fakeClient(sent));

    expect(sent).toHaveLength(2);
    expect((sent[0] as { content: string }).content).toBe("part one");
    const second = sent[1] as { content: string; files: unknown[] };
    expect(second.content).toBe("part two");
    expect(second.files).toHaveLength(1);
  });
});
