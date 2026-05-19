import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  pollWeixinQrLogin,
  startWeixinQrLogin,
  DEFAULT_WEIXIN_BASE_URL,
} from "../src/im/adapters/weixin/api.js";
import { saveWeixinAccount } from "../src/im/adapters/weixin/store.js";

const timeoutMs = Number.parseInt(process.env.MINICLAW_WEIXIN_LOGIN_TIMEOUT_MS ?? "", 10) || 8 * 60_000;
const pollIntervalMs = 1_000;

function normalizeAccountId(raw: string): string {
  return raw.trim().replace(/[^A-Za-z0-9_-]+/g, "-");
}

async function askVerifyCode(prompt: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return (await rl.question(prompt)).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const stateDir = process.env.MINICLAW_WEIXIN_STATE_DIR?.trim() || undefined;
  const started = await startWeixinQrLogin();
  if (!started.qrcode || !started.qrcode_img_content) {
    throw new Error("Weixin login did not return a QR code");
  }

  console.log("用手机微信打开下面链接或生成二维码扫码，以继续连接 MiniClaw：");
  console.log(started.qrcode_img_content);
  console.log("");

  const deadline = Date.now() + timeoutMs;
  let verifyCode: string | undefined;
  let pollingBaseUrl = DEFAULT_WEIXIN_BASE_URL;
  while (Date.now() < deadline) {
    const status = await pollWeixinQrLogin({
      qrcode: started.qrcode,
      verifyCode,
      options: { baseUrl: pollingBaseUrl, timeoutMs: 35_000 },
    });

    if (status.status === "confirmed" && status.bot_token && status.ilink_bot_id) {
      const accountId = normalizeAccountId(status.ilink_bot_id);
      saveWeixinAccount(accountId, {
        token: status.bot_token,
        baseUrl: status.baseurl || DEFAULT_WEIXIN_BASE_URL,
        userId: status.ilink_user_id,
      }, stateDir);
      console.log(`已保存 Weixin account：${accountId}`);
      return;
    }

    if (status.status === "need_verifycode" || status.status === "verify_code_blocked") {
      verifyCode = await askVerifyCode("请输入微信页面显示的配对码后回车：");
      continue;
    }

    if (status.status === "expired") {
      throw new Error("Weixin login QR code expired; rerun `pnpm weixin:login`");
    }

    if (status.status === "binded_redirect") {
      console.log("微信提示这个 bot 已连接过当前应用；本地已有凭证时可直接启用 MiniClaw Weixin。");
      return;
    }

    if (status.status === "scaned_but_redirect" && status.redirect_host) {
      pollingBaseUrl = `https://${status.redirect_host}`;
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error("Weixin login timed out");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
