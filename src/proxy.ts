import "dotenv/config";
import { createRequire } from "node:module";

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
    constructor(address: string | URL, p2?: unknown, p3?: unknown) {
      if (p2 && typeof p2 === "object" && !Array.isArray(p2)) {
        super(address, { ...(p2 as object), agent });
      } else if (p3 && typeof p3 === "object") {
        super(address, p2 as string | string[], { ...(p3 as object), agent });
      } else if (p2 !== undefined) {
        super(address, p2 as string | string[], { agent });
      } else {
        super(address, { agent });
      }
    }
  }

  ws.WebSocket = ProxiedWebSocket;

  console.log(`[MiniClaw] Proxy: ${proxyUrl}`);
}
