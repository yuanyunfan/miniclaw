#!/usr/bin/env tsx
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runId = process.env.MINICLAW_E2E_RUN_ID ?? `cron-e2e-${Date.now()}`;
const channelId = "1000000000000000001";
const root = mkdtempSync(join(tmpdir(), "miniclaw-cron-e2e-"));
const cronDir = join(root, "cron");
const scriptsDir = join(root, "scripts");
const cwd = join(root, "cwd");
const artifactDir = join(process.cwd(), "artifacts", "e2e", runId);
mkdirSync(cronDir, { recursive: true });
mkdirSync(scriptsDir, { recursive: true });
mkdirSync(cwd, { recursive: true });
mkdirSync(artifactDir, { recursive: true });

const configPath = join(root, "config.yaml");
writeFileSync(configPath, `
discord:
  token: "test-token"
  client_id: "test-client"
  guild_id: "test-guild"
  allowed_user_id: "test-user"
agent:
  provider: codex
  default_cwd: "${cwd}"
  max_concurrent_tasks: 1
storage:
  db_path: "${join(root, "data.db")}"
  memory_path: "${join(root, "MEMORY.md")}"
e2e:
  mode: true
  sender_user_ids: ["test-user"]
  disable_scheduler: true
  fake_agent: true
`, "utf8");

writeFileSync(join(cronDir, "message.yaml"), `
name: e2e-message
enabled: true
schedule: "* * * * *"
type: message
channel: "${channelId}"
content: "E2E_CRON_MESSAGE_OK {{cron.name}}"
`, "utf8");

writeFileSync(join(cronDir, "script.yaml"), `
name: e2e-script
enabled: true
schedule: "* * * * *"
type: script
channel: "${channelId}"
script: "ok.sh"
capture_output: true
timeout_sec: 5
`, "utf8");

writeFileSync(join(cronDir, "task.yaml"), `
name: e2e-task
enabled: true
schedule: "* * * * *"
type: task
channel: "${channelId}"
cwd: "${cwd}"
prompt: "e2e task ${runId}"
`, "utf8");

const scriptPath = join(scriptsDir, "ok.sh");
writeFileSync(scriptPath, "#!/usr/bin/env bash\necho 'E2E_CRON_SCRIPT_OK'\n", "utf8");
chmodSync(scriptPath, 0o755);

process.env.MINICLAW_CONFIG = configPath;
process.env.MINICLAW_CRON_DIR = cronDir;
process.env.MINICLAW_SCRIPTS_DIR = scriptsDir;
process.env.MINICLAW_CRON_STATE = join(root, "cron-state.json");
process.env.MINICLAW_E2E_MODE = "true";
process.env.MINICLAW_E2E_FAKE_AGENT = "true";
process.env.MINICLAW_DISABLE_SCHEDULER = "true";
process.env.MINICLAW_E2E_SENDER_USER_IDS = "test-user";

interface SentMessage {
  content: string;
  payload: unknown;
}

const sent: SentMessage[] = [];
const fakeChannel = {
  id: channelId,
  isSendable: () => true,
  send: async (payload: unknown) => {
    const content = typeof payload === "string"
      ? payload
      : payload && typeof payload === "object" && "content" in payload
        ? String((payload as { content?: unknown }).content ?? "")
        : "";
    sent.push({ content, payload });
    return { id: `msg-${sent.length}`, edit: async () => undefined };
  },
};

const fakeClient = {
  channels: {
    fetch: async (id: string) => id === channelId ? fakeChannel : null,
  },
};

function assertSent(label: string, needle: string): void {
  if (!sent.some((message) => message.content.includes(needle))) {
    throw new Error(`${label} did not emit expected output: ${needle}\n${sent.map((m) => m.content).join("\n")}`);
  }
}

const { initDb } = await import("../src/store/db.js");
const { runJobNow } = await import("../src/cron/scheduler.js");
initDb();
await runJobNow("e2e-message", fakeClient as never);
await runJobNow("e2e-script", fakeClient as never);
await runJobNow("e2e-task", fakeClient as never);

assertSent("message cron", "E2E_CRON_MESSAGE_OK e2e-message");
assertSent("script cron", "E2E_CRON_SCRIPT_OK");
assertSent("task cron", `E2E_TASK_OK ${runId}`);

writeFileSync(join(artifactDir, "discord-transcript.md"), sent.map((m) => m.content).join("\n---\n"), "utf8");
writeFileSync(join(artifactDir, "summary.json"), JSON.stringify({
  runId,
  status: "passed",
  messages: sent.map((m) => m.content),
}, null, 2), "utf8");

console.log(`Cron E2E fixture passed: ${runId}`);
