import "dotenv/config";
import { lookup as dnsLookup } from "node:dns";
import { createRequire } from "node:module";
import { createLogger } from "./lib/log.js";

const log = createLogger("proxy");
const require = createRequire(import.meta.url);
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.MINICLAW_PROXY;
const DISCORD_GATEWAY_HOST = "gateway.discord.gg";
const DEFAULT_DISCORD_GATEWAY_IPS = [
  "162.159.130.234",
  "162.159.133.234",
  "162.159.134.234",
  "162.159.135.234",
  "162.159.136.234",
];

type LookupOptions = { all?: boolean };
type LookupAddress = { address: string; family: number };
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;
type LookupFn = (
  hostname: string,
  options: LookupOptions | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
  callback?: LookupCallback,
) => void;

function gatewayFallbackIps(): string[] {
  const raw = process.env.MINICLAW_DISCORD_GATEWAY_IPS;
  const ips = raw?.split(",").map((v) => v.trim()).filter(Boolean);
  return ips?.length ? ips : DEFAULT_DISCORD_GATEWAY_IPS;
}

let gatewayFallbackIndex = 0;

function fallbackGatewayLookup(options: LookupOptions, cb: LookupCallback, reason: unknown): void {
  const ips = gatewayFallbackIps();
  const start = gatewayFallbackIndex++ % ips.length;
  const ordered = [...ips.slice(start), ...ips.slice(0, start)];
  log.warn(
    `DNS lookup for ${DISCORD_GATEWAY_HOST} bypassed; using fallback IP ${ordered[0]} ` +
    `(${reason instanceof Error ? reason.message : String(reason)})`
  );
  if (options.all) {
    cb(null, ordered.map((address) => ({ address, family: 4 })));
    return;
  }
  cb(null, ordered[0], 4);
}

function discordGatewayLookup(hostname: string, rawOptions: unknown, rawCallback?: unknown): void {
  const options = typeof rawOptions === "function" ? {} : (rawOptions ?? {}) as LookupOptions;
  const cb = (typeof rawOptions === "function" ? rawOptions : rawCallback) as LookupCallback;
  if (typeof cb !== "function") {
    throw new Error("lookup callback is required");
  }

  if (hostname === DISCORD_GATEWAY_HOST) {
    fallbackGatewayLookup(options, cb, "forced gateway fallback");
    return;
  }

  const lookup = dnsLookup as unknown as LookupFn;
  lookup(hostname, options, (err, address, family) => {
    if (!err) {
      cb(null, address, family);
      return;
    }
    if (hostname !== DISCORD_GATEWAY_HOST) {
      cb(err, address, family);
      return;
    }
    fallbackGatewayLookup(options, cb, err);
  });
}

function patchWebSocket(agent?: unknown): void {
  const ws = require("ws");
  const OrigWS = ws.WebSocket ?? ws;

  class MiniClawWebSocket extends OrigWS {
    constructor(...args: unknown[]) {
      const [address, ...rest] = args;
      let protocols: unknown;
      let options: Record<string, unknown> = {};

      if (rest.length === 0) {
        // (address)
      } else if (rest.length === 1 && typeof rest[0] === "object" && !Array.isArray(rest[0])) {
        // (address, options)
        options = (rest[0] ?? {}) as Record<string, unknown>;
      } else if (rest.length === 1) {
        // (address, protocols)
        protocols = rest[0];
      } else {
        // (address, protocols, options)
        protocols = rest[0];
        options = ((rest[1] ?? {}) as Record<string, unknown>);
      }

      const merged = {
        ...options,
        ...(agent ? { agent } : {}),
        lookup: options.lookup ?? discordGatewayLookup,
      };
      if (protocols !== undefined) {
        super(address as string | URL, protocols as string | string[], merged);
      } else {
        super(address as string | URL, merged);
      }
    }
  }

  ws.WebSocket = MiniClawWebSocket;
  Object.defineProperty(globalThis, "WebSocket", {
    value: MiniClawWebSocket,
    writable: true,
    configurable: true,
  });
  log.info("WebSocket patch: Discord gateway DNS fallback enabled");
}

if (proxyUrl) {
  const { ProxyAgent, setGlobalDispatcher } = require("undici");
  setGlobalDispatcher(new ProxyAgent(proxyUrl));

  const { HttpsProxyAgent } = require("https-proxy-agent");
  const agent = new HttpsProxyAgent(proxyUrl);
  patchWebSocket(agent);
  log.info(`Proxy: ${proxyUrl}`);
} else {
  patchWebSocket();
}

export const __testables = { discordGatewayLookup, gatewayFallbackIps };
