import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadFutuStockConfig, resolveFutuStockProfile } from "./config.js";
import { PythonFutuStockClient } from "./futu-client.js";
import { mapFutuRawBrokerData, topFutuPositionsByDailyPnl } from "./mapper.js";
import { formatFutuDailyPnlReport, redactedSnapshotJson } from "./redact.js";
import { assertAllowedToolName, FUTU_STOCK_TOOL_NAMES, sanitizeError } from "./safety.js";
import type {
  FutuAccountSnapshot,
  FutuRedactionLevel,
  FutuStockClient,
  FutuStockConfig,
  FutuStockProfileConfig,
  FutuToolRequest,
} from "./types.js";

const VERSION = "0.1.0";

const baseInputSchema = {
  profile: z.string().optional().describe("Local futu-stock profile name. This is not a password or token."),
  account_alias: z.string().optional().describe("Display-only alias for this report."),
  market_session: z.string().optional().describe("Report scope, for example hk_close or us_close."),
  redaction: z.enum(["summary", "exact"]).optional().describe("summary hides total asset exact values; exact should be used only in trusted channels."),
  top_positions_limit: z.number().int().min(0).max(20).optional().describe("How many top gain/loss positions to include."),
};

export interface FutuStockServerDeps {
  client?: FutuStockClient;
  loadConfig?: () => FutuStockConfig;
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

function errorResult(err: unknown) {
  return {
    content: [{ type: "text" as const, text: `futu-stock error: ${sanitizeError(err)}` }],
    isError: true,
  };
}

function requestProfile(
  request: FutuToolRequest,
  loadConfig: () => FutuStockConfig,
): FutuStockProfileConfig {
  return resolveFutuStockProfile(loadConfig(), request.profile ?? "default", {
    account_alias: request.account_alias,
    redaction: request.redaction,
  });
}

async function buildSnapshot(
  request: FutuToolRequest,
  client: FutuStockClient,
  loadConfig: () => FutuStockConfig,
): Promise<{ profile: FutuStockProfileConfig; snapshot: FutuAccountSnapshot }> {
  const profile = requestProfile(request, loadConfig);
  const raw = await client.getRawBrokerData(profile);
  return {
    profile,
    snapshot: mapFutuRawBrokerData(raw, profile, request.market_session ?? "unspecified"),
  };
}

function topLimit(value: number | undefined): number {
  if (value === undefined) return 5;
  return Math.max(0, Math.min(20, value));
}

export function createFutuStockToolHandlers(deps: FutuStockServerDeps = {}) {
  const client = deps.client ?? new PythonFutuStockClient();
  const loadConfig = deps.loadConfig ?? loadFutuStockConfig;
  return {
    async futu_health_check(request: FutuToolRequest) {
      try {
        const profile = requestProfile(request, loadConfig);
        const health = await client.healthCheck(profile);
        return textResult(JSON.stringify(health, null, 2), health as unknown as Record<string, unknown>);
      } catch (err) {
        return errorResult(err);
      }
    },

    async futu_get_account_snapshot(request: FutuToolRequest) {
      try {
        const { profile, snapshot } = await buildSnapshot(request, client, loadConfig);
        const text = redactedSnapshotJson(snapshot, profile);
        return textResult(text, { account_alias: snapshot.account_alias, captured_at: snapshot.captured_at });
      } catch (err) {
        return errorResult(err);
      }
    },

    async futu_get_positions_summary(request: FutuToolRequest) {
      try {
        const { snapshot } = await buildSnapshot(request, client, loadConfig);
        const positions = topFutuPositionsByDailyPnl(snapshot, topLimit(request.top_positions_limit));
        const payload = {
          account_alias: snapshot.account_alias,
          captured_at: snapshot.captured_at,
          currency: snapshot.currency,
          positions_count: snapshot.positions.length,
          top_positions: positions,
          warnings: snapshot.warnings,
        };
        return textResult(JSON.stringify(payload, null, 2), payload as unknown as Record<string, unknown>);
      } catch (err) {
        return errorResult(err);
      }
    },

    async futu_get_daily_pnl_report(request: FutuToolRequest) {
      try {
        const { profile, snapshot } = await buildSnapshot(request, client, loadConfig);
        const text = formatFutuDailyPnlReport(snapshot, profile, {
          redaction: request.redaction as FutuRedactionLevel | undefined,
          topPositionsLimit: topLimit(request.top_positions_limit),
        });
        return textResult(text, { account_alias: snapshot.account_alias, captured_at: snapshot.captured_at });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function createFutuStockMcpServer(deps: FutuStockServerDeps = {}): McpServer {
  for (const name of FUTU_STOCK_TOOL_NAMES) assertAllowedToolName(name);
  const handlers = createFutuStockToolHandlers(deps);
  const server = new McpServer({ name: "futu-stock", version: VERSION });

  server.registerTool("futu_health_check", {
    title: "Futu Health Check",
    description: "Check local OpenD connectivity and Python futu-api availability without returning credentials.",
    inputSchema: baseInputSchema,
  }, handlers.futu_health_check);

  server.registerTool("futu_get_account_snapshot", {
    title: "Futu Account Snapshot",
    description: "Return a redacted Futu account funds snapshot through local OpenD.",
    inputSchema: baseInputSchema,
  }, handlers.futu_get_account_snapshot);

  server.registerTool("futu_get_positions_summary", {
    title: "Futu Positions Summary",
    description: "Return redacted top position gain/loss summaries through local OpenD.",
    inputSchema: baseInputSchema,
  }, handlers.futu_get_positions_summary);

  server.registerTool("futu_get_daily_pnl_report", {
    title: "Futu Daily P&L Report",
    description: "Return a Discord-ready, redacted daily P&L report input for MiniClaw tasks.",
    inputSchema: baseInputSchema,
  }, handlers.futu_get_daily_pnl_report);

  return server;
}

export async function runFutuStockMcpServer(): Promise<void> {
  const server = createFutuStockMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFutuStockMcpServer().catch((err) => {
    console.error(`futu-stock MCP server failed: ${sanitizeError(err)}`);
    process.exit(1);
  });
}
