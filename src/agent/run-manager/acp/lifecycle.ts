import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { AgentBus } from "../bus.js";
import { AgentRunAcpAdapter } from "./adapter.js";
import { listenAgentRunAcpHttpServer } from "./server.js";

export interface AgentRunAcpLifecycleConfig {
  enabled: boolean;
  host: string;
  port: number;
  token?: string;
  maxPayloadBytes: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  traceExportEnabled: boolean;
  traceMaxEvents: number;
  traceMaxBytes: number;
}

export interface AgentRunAcpLifecycleHandle {
  host: string;
  port: number;
  url: string;
  token: string;
  stop: () => Promise<void>;
}

export const DEFAULT_AGENT_RUN_MANAGER_ACP_CONFIG: AgentRunAcpLifecycleConfig = {
  enabled: false,
  host: "127.0.0.1",
  port: 0,
  maxPayloadBytes: 256 * 1024,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 120,
  traceExportEnabled: false,
  traceMaxEvents: 200,
  traceMaxBytes: 96_000,
};

export async function startAgentRunAcpLifecycle(input: {
  config: AgentRunAcpLifecycleConfig;
  taskId: string;
  cwd: string;
  bus: AgentBus;
}): Promise<AgentRunAcpLifecycleHandle | undefined> {
  if (!input.config.enabled) return undefined;

  const token = input.config.token?.trim() || randomUUID();
  const adapter = new AgentRunAcpAdapter({
    taskId: input.taskId,
    cwd: input.cwd,
    bus: input.bus,
    token,
  });
  const server = await listenAgentRunAcpHttpServer(adapter, {
    host: input.config.host,
    port: input.config.port,
    maxPayloadBytes: input.config.maxPayloadBytes,
    rateLimit: {
      windowMs: input.config.rateLimitWindowMs,
      maxRequests: input.config.rateLimitMaxRequests,
    },
    traceExport: {
      enabled: input.config.traceExportEnabled,
      maxEvents: input.config.traceMaxEvents,
      maxBytes: input.config.traceMaxBytes,
    },
  });
  const address = server.address() as AddressInfo | null;
  const host = address?.address ?? input.config.host;
  const port = address?.port ?? input.config.port;
  return {
    host,
    port,
    url: `http://${host}:${port}`,
    token,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
