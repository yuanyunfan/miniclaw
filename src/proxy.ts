import "dotenv/config";
import { createRequire } from "node:module";
import { createLogger } from "./lib/log.js";

const log = createLogger("proxy");
const require = createRequire(import.meta.url);
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.MINICLAW_PROXY;

if (proxyUrl) {
  const { ProxyAgent, setGlobalDispatcher } = require("undici");
  setGlobalDispatcher(new ProxyAgent(proxyUrl));

  const { HttpsProxyAgent } = require("https-proxy-agent");
  const agent = new HttpsProxyAgent(proxyUrl);

  const ws = require("ws");
  const OrigWS = ws.WebSocket ?? ws;

  class ProxiedWebSocket extends OrigWS {
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

      const merged = { ...options, agent };
      if (protocols !== undefined) {
        super(address as string | URL, protocols as string | string[], merged);
      } else {
        super(address as string | URL, merged);
      }
    }
  }

  ws.WebSocket = ProxiedWebSocket;

  log.info(`Proxy: ${proxyUrl}`);
}
