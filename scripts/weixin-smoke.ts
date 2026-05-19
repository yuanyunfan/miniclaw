#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { createWeixinTransport } from "../src/im/adapters/weixin/transport.js";
import {
  DEFAULT_WEIXIN_BASE_URL,
  getWeixinUpdates,
  WeixinMessageItemType,
  type WeixinMessage,
} from "../src/im/adapters/weixin/api.js";
import {
  resolveWeixinAccount,
  saveWeixinGetUpdatesBuf,
} from "../src/im/adapters/weixin/store.js";

type Seen = {
  text: boolean;
  image: boolean;
  voice: boolean;
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  return inline?.slice(prefix.length);
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm weixin:smoke -- --account <accountId> --target <user@im.wechat> [--image /path/pic.jpg] [--listen-seconds 90] [--save-buffer]",
    "",
    "What it does:",
    "  1. Resolves the local Weixin login state.",
    "  2. Sends an outbound text message and optional image/file to the target.",
    "  3. Polls getupdates while you send the requested text, image, and voice from Weixin.",
    "",
    "Notes:",
    "  Stop the normal MiniClaw Weixin gateway before the inbound part to avoid competing getupdates consumers.",
    "  Use --save-buffer only when this smoke script is the only active getupdates consumer.",
  ].join("\n");
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itemHasOfficialMedia(item: { media?: unknown } | undefined): boolean {
  if (!item || typeof item.media !== "object" || item.media === null) return false;
  const media = item.media as Record<string, unknown>;
  return typeof media.full_url === "string"
    || typeof media.encrypt_query_param === "string"
    || typeof media.aes_key === "string";
}

function markSeen(message: WeixinMessage, nonce: string, seen: Seen): void {
  for (const item of message.item_list ?? []) {
    if (item.type === WeixinMessageItemType.TEXT && item.text_item?.text?.includes(nonce)) {
      seen.text = true;
    }
    if (item.type === WeixinMessageItemType.IMAGE && (itemHasOfficialMedia(item.image_item) || item.image_item)) {
      seen.image = true;
    }
    if (item.type === WeixinMessageItemType.VOICE && (itemHasOfficialMedia(item.voice_item) || item.voice_item?.text)) {
      seen.voice = true;
    }
  }
}

function seenSummary(seen: Seen): string {
  return [
    `text=${seen.text ? "ok" : "missing"}`,
    `image=${seen.image ? "ok" : "missing"}`,
    `voice=${seen.voice ? "ok" : "missing"}`,
  ].join(" ");
}

async function main(): Promise<void> {
  if (hasArg("--help") || hasArg("-h")) {
    console.log(usage());
    return;
  }

  const stateDir = argValue("--state-dir") ?? process.env.MINICLAW_WEIXIN_STATE_DIR;
  const accountId = argValue("--account");
  const target = argValue("--target");
  const imagePath = argValue("--image");
  const listenSeconds = parsePositiveInt(argValue("--listen-seconds"), 90);
  const skipOutbound = hasArg("--skip-outbound");
  const skipInbound = hasArg("--skip-inbound");
  const saveBuffer = hasArg("--save-buffer");
  const account = resolveWeixinAccount(accountId, stateDir);
  const effectiveTarget = target ?? account.userId;
  const nonce = `miniclaw-weixin-smoke-${randomUUID().slice(0, 8)}`;

  console.log(`Weixin smoke account=${account.accountId}`);
  if (effectiveTarget) console.log(`Target user=${effectiveTarget}`);
  console.log(`Nonce=${nonce}`);

  if (!skipOutbound) {
    if (!effectiveTarget) {
      console.warn("Outbound smoke skipped: pass --target or login with a stored userId.");
    } else {
      const transport = createWeixinTransport({ stateDir, defaultAccountId: account.accountId });
      await transport.send({
        target: { transport: "weixin", target: effectiveTarget, accountId: account.accountId },
        content: `MiniClaw Weixin smoke outbound text: ${nonce}`,
      });
      console.log("Outbound text sent.");
      if (imagePath) {
        if (!existsSync(imagePath)) throw new Error(`--image path does not exist: ${imagePath}`);
        if (!transport.sendFile) throw new Error("Weixin transport does not expose sendFile; outbound media smoke cannot run.");
        await transport.sendFile({
          target: { transport: "weixin", target: effectiveTarget, accountId: account.accountId },
          path: imagePath,
          name: basename(imagePath),
          description: `MiniClaw Weixin smoke outbound media: ${nonce}`,
        });
        console.log("Outbound media sent.");
      }
    }
  }

  if (skipInbound) {
    console.log("Inbound smoke skipped by --skip-inbound.");
    return;
  }

  console.log("");
  console.log("Inbound smoke instructions:");
  console.log(`  1. Send this exact text from Weixin to MiniClaw: ${nonce}`);
  console.log("  2. Send one image from Weixin to MiniClaw.");
  console.log("  3. Send one voice message from Weixin to MiniClaw.");
  console.log(`Listening for ${listenSeconds}s...`);

  const seen: Seen = { text: false, image: false, voice: false };
  let getUpdatesBuf = account.getUpdatesBuf ?? "";
  const deadline = Date.now() + listenSeconds * 1000;
  while (Date.now() < deadline && !(seen.text && seen.image && seen.voice)) {
    const resp = await getWeixinUpdates({
      getUpdatesBuf,
      options: {
        baseUrl: account.baseUrl || DEFAULT_WEIXIN_BASE_URL,
        token: account.token,
        timeoutMs: 35_000,
      },
    });
    const code = resp.errcode ?? resp.ret ?? 0;
    if (code !== 0) {
      throw new Error(`getupdates failed during smoke: code=${code} errmsg=${resp.errmsg ?? ""}`);
    }
    if (resp.get_updates_buf !== undefined) getUpdatesBuf = resp.get_updates_buf;
    for (const message of resp.msgs ?? []) {
      if (effectiveTarget && message.from_user_id && message.from_user_id !== effectiveTarget) continue;
      markSeen(message, nonce, seen);
    }
    if (!(seen.text && seen.image && seen.voice)) await sleep(500);
  }

  if (saveBuffer) {
    saveWeixinGetUpdatesBuf(account.accountId, getUpdatesBuf, stateDir);
    console.log("Saved updated getupdates buffer.");
  } else {
    console.log("Did not save getupdates buffer. Re-run with --save-buffer when MiniClaw gateway is stopped.");
  }

  console.log(`Inbound result: ${seenSummary(seen)}`);
  if (!(seen.text && seen.image && seen.voice)) {
    process.exitCode = 1;
    console.error("Weixin smoke failed: not all inbound payload types were observed.");
    return;
  }

  console.log("Weixin smoke passed. For chat/task routing, restart MiniClaw and manually verify chat reply plus task y/n confirmation with the same account.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
