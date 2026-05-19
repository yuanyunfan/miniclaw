#!/usr/bin/env tsx
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  WEIXIN_OFFICIAL_PACKAGE_NAME,
  WEIXIN_OFFICIAL_PACKAGE_SOURCE_NAME,
  WEIXIN_OFFICIAL_PACKAGE_VERSION,
  WEIXIN_OFFICIAL_PROTOCOL_FILES,
} from "../src/im/adapters/weixin/protocol.js";

type Anchor = {
  file: string;
  label: string;
  pattern: RegExp | string;
};

type Finding = {
  scope: "official" | "miniclaw";
  file: string;
  label: string;
};

const DEFAULT_OFFICIAL_DIR = `/Users/yuan/Desktop/${WEIXIN_OFFICIAL_PACKAGE_SOURCE_NAME}-${WEIXIN_OFFICIAL_PACKAGE_VERSION}`;

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
    "Usage: pnpm weixin:drift-check -- --package-dir /path/to/tencent-weixin-openclaw-weixin-2.4.3",
    "",
    "Environment fallback:",
    "  MINICLAW_WEIXIN_OFFICIAL_PACKAGE_DIR=/path/to/package",
    "  WEIXIN_OFFICIAL_PACKAGE_DIR=/path/to/package",
    "",
    `Aligned source snapshot: ${WEIXIN_OFFICIAL_PACKAGE_SOURCE_NAME} ${WEIXIN_OFFICIAL_PACKAGE_VERSION}`,
    `Default local path: ${DEFAULT_OFFICIAL_DIR}`,
  ].join("\n");
}

function officialPackageDir(): string {
  const configured = argValue("--package-dir")
    ?? process.env.MINICLAW_WEIXIN_OFFICIAL_PACKAGE_DIR
    ?? process.env.WEIXIN_OFFICIAL_PACKAGE_DIR
    ?? DEFAULT_OFFICIAL_DIR;
  return resolve(configured);
}

function readText(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}

function matches(text: string, pattern: RegExp | string): boolean {
  return typeof pattern === "string" ? text.includes(pattern) : pattern.test(text);
}

function verifyAnchors(root: string, scope: Finding["scope"], anchors: Anchor[]): Finding[] {
  const findings: Finding[] = [];
  for (const anchor of anchors) {
    const path = join(root, anchor.file);
    if (!existsSync(path)) {
      findings.push({ scope, file: anchor.file, label: "missing file" });
      continue;
    }
    const text = readText(root, anchor.file);
    if (!matches(text, anchor.pattern)) {
      findings.push({ scope, file: anchor.file, label: anchor.label });
    }
  }
  return findings;
}

const officialAnchors: Anchor[] = [
  {
    file: "package.json",
    label: `package name must be ${WEIXIN_OFFICIAL_PACKAGE_NAME}`,
    pattern: new RegExp(`"name"\\s*:\\s*"${WEIXIN_OFFICIAL_PACKAGE_NAME.replace("/", "\\/")}"`),
  },
  {
    file: "package.json",
    label: `package version must be ${WEIXIN_OFFICIAL_PACKAGE_VERSION}`,
    pattern: new RegExp(`"version"\\s*:\\s*"${WEIXIN_OFFICIAL_PACKAGE_VERSION.replaceAll(".", "\\.")}"`),
  },
  {
    file: "src/api/types.ts",
    label: "CDNMedia must keep encrypt_query_param, aes_key, encrypt_type, and full_url",
    pattern: /interface\s+CDNMedia[\s\S]*encrypt_query_param\?[\s\S]*aes_key\?[\s\S]*encrypt_type\?[\s\S]*full_url\?/,
  },
  {
    file: "src/api/types.ts",
    label: "MessageItemType values must keep TEXT=1 IMAGE=2 VOICE=3 FILE=4 VIDEO=5",
    pattern: /MessageItemType[\s\S]*TEXT:\s*1[\s\S]*IMAGE:\s*2[\s\S]*VOICE:\s*3[\s\S]*FILE:\s*4[\s\S]*VIDEO:\s*5/,
  },
  {
    file: "src/api/types.ts",
    label: "UploadMediaType values must keep IMAGE=1 VIDEO=2 FILE=3 VOICE=4",
    pattern: /UploadMediaType[\s\S]*IMAGE:\s*1[\s\S]*VIDEO:\s*2[\s\S]*FILE:\s*3[\s\S]*VOICE:\s*4/,
  },
  {
    file: "src/api/types.ts",
    label: "GetUploadUrlResp must keep upload_param and upload_full_url",
    pattern: /interface\s+GetUploadUrlResp[\s\S]*upload_param\?[\s\S]*upload_full_url\?/,
  },
  {
    file: "src/media/media-download.ts",
    label: "inbound media must still branch on image_item.media full_url/encrypt_query_param",
    pattern: /image_item[\s\S]*media[\s\S]*encrypt_query_param[\s\S]*full_url[\s\S]*downloadAndDecryptBuffer/,
  },
  {
    file: "src/media/media-download.ts",
    label: "inbound image must still prefer image_item.aeskey over media.aes_key",
    pattern: /img\.aeskey[\s\S]*Buffer\.from\(img\.aeskey,\s*"hex"\)[\s\S]*img\.media\.aes_key/,
  },
  {
    file: "src/media/media-download.ts",
    label: "inbound voice must still decrypt media and try silkToWav",
    pattern: /voice_item[\s\S]*voice\??\.media\??\.aes_key[\s\S]*downloadAndDecryptBuffer[\s\S]*silkToWav/,
  },
  {
    file: "src/messaging/send-media.ts",
    label: "outbound media must still route image/video/file through upload then send",
    pattern: /sendWeixinMediaFile[\s\S]*uploadVideoToWeixin[\s\S]*sendVideoMessageWeixin[\s\S]*uploadFileToWeixin[\s\S]*sendImageMessageWeixin[\s\S]*uploadFileAttachmentToWeixin[\s\S]*sendFileMessageWeixin/,
  },
  {
    file: "src/cdn/upload.ts",
    label: "upload pipeline must still use getUploadUrl, upload_full_url/upload_param, aeskey, raw MD5, and AES padded size",
    pattern: /getUploadUrl[\s\S]*rawfilemd5[\s\S]*aesEcbPaddedSize[\s\S]*upload_full_url[\s\S]*upload_param[\s\S]*uploadBufferToCdn/,
  },
  {
    file: "src/api/session-guard.ts",
    label: "session expired guard must keep errcode -14",
    pattern: /SESSION_EXPIRED_ERRCODE\s*=\s*-14/,
  },
  {
    file: "src/api/session-guard.ts",
    label: "session expired guard must keep a one-hour pause",
    pattern: /SESSION_PAUSE_DURATION_MS\s*=\s*60\s*\*\s*60\s*\*\s*1000/,
  },
  {
    file: "src/auth/login-qr.ts",
    label: "QR login must still submit local_token_list",
    pattern: /local_token_list[\s\S]*get_bot_qrcode/,
  },
];

const miniclawAnchors: Anchor[] = [
  {
    file: "src/im/adapters/weixin/protocol.ts",
    label: "MiniClaw protocol marker must keep the aligned package version",
    pattern: new RegExp(`WEIXIN_OFFICIAL_PACKAGE_VERSION\\s*=\\s*"${WEIXIN_OFFICIAL_PACKAGE_VERSION.replaceAll(".", "\\.")}"`),
  },
  {
    file: "src/im/adapters/weixin/api.ts",
    label: "MiniClaw API must use the official package version as channel_version",
    pattern: /DEFAULT_WEIXIN_CHANNEL_VERSION\s*=\s*WEIXIN_OFFICIAL_PACKAGE_VERSION/,
  },
  {
    file: "src/im/adapters/weixin/api.ts",
    label: "MiniClaw API must keep official endpoints for getupdates, sendmessage, getuploadurl, getconfig, sendtyping, and QR login",
    pattern: /ilink\/bot\/getupdates[\s\S]*ilink\/bot\/sendmessage[\s\S]*ilink\/bot\/getuploadurl[\s\S]*ilink\/bot\/getconfig[\s\S]*ilink\/bot\/sendtyping[\s\S]*get_bot_qrcode/,
  },
  {
    file: "src/im/adapters/weixin/media.ts",
    label: "MiniClaw media must keep official CDN download/decrypt fields",
    pattern: /media\.full_url[\s\S]*encrypt_query_param[\s\S]*decryptAesEcb[\s\S]*aesKeyBase64/,
  },
  {
    file: "src/im/adapters/weixin/media.ts",
    label: "MiniClaw media must keep official upload chain fields",
    pattern: /getWeixinUploadUrl[\s\S]*rawfilemd5[\s\S]*aesEcbPaddedSize[\s\S]*uploadBufferToCdn[\s\S]*encrypt_query_param[\s\S]*aes_key/,
  },
  {
    file: "src/im/adapters/weixin/session.ts",
    label: "MiniClaw session guard must keep errcode -14 and one-hour pause",
    pattern: /60\s*\*\s*60\s*\*\s*1000[\s\S]*WEIXIN_SESSION_EXPIRED_ERRCODE\s*=\s*-14/,
  },
  {
    file: "src/im/adapters/weixin/transport.ts",
    label: "MiniClaw Weixin transport must advertise file support",
    pattern: /files:\s*true/,
  },
  {
    file: "scripts/weixin-login.ts",
    label: "MiniClaw QR login must keep local token list and expired QR refresh",
    pattern: /recentWeixinBotTokens[\s\S]*localTokenList[\s\S]*status\.status\s*===\s*"expired"[\s\S]*maxQrRefreshes/,
  },
];

async function main(): Promise<void> {
  if (hasArg("--help") || hasArg("-h")) {
    console.log(usage());
    return;
  }

  const officialDir = officialPackageDir();
  if (!existsSync(officialDir)) {
    console.error(`Official Weixin package source not found: ${officialDir}`);
    console.error(usage());
    process.exit(1);
  }

  const missingProtocolFiles = WEIXIN_OFFICIAL_PROTOCOL_FILES
    .filter((file) => !existsSync(join(officialDir, file)));
  const officialFindings = verifyAnchors(officialDir, "official", officialAnchors);
  const miniclawFindings = verifyAnchors(process.cwd(), "miniclaw", miniclawAnchors);
  const findings: Finding[] = [
    ...missingProtocolFiles.map((file) => ({
      scope: "official" as const,
      file,
      label: "tracked official protocol file is missing",
    })),
    ...officialFindings,
    ...miniclawFindings,
  ];

  if (findings.length) {
    console.error("Weixin protocol drift check failed:");
    for (const finding of findings) {
      console.error(`- ${finding.scope}:${finding.file}: ${finding.label}`);
    }
    console.error("");
    console.error(`Official package directory: ${officialDir}`);
    process.exit(1);
  }

  console.log(
    `Weixin protocol drift check passed: ${WEIXIN_OFFICIAL_PACKAGE_NAME} ${WEIXIN_OFFICIAL_PACKAGE_VERSION} (${basename(officialDir)}), ${officialAnchors.length + miniclawAnchors.length} anchor(s).`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
