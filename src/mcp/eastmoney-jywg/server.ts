import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { loadEastmoneyJywgConfig, resolveEastmoneyJywgProfile } from "./config.js";
import { HttpEastmoneyJywgClient } from "./client.js";
import { mapEastmoneyJywgRawBrokerData, topEastmoneyJywgPositionsByPnl } from "./mapper.js";
import { formatEastmoneyJywgDailyPnlReport, redactedSnapshotJson } from "./redact.js";
import { loadEastmoneyJywgSession } from "./session-vault.js";
import { assertAllowedToolName, EASTMONEY_JYWG_TOOL_NAMES, sanitizeError } from "./safety.js";
import type {
  EastmoneyJywgAccountSnapshot,
  EastmoneyJywgClient,
  EastmoneyJywgConfig,
  EastmoneyJywgProfileConfig,
  EastmoneyJywgRedactionLevel,
  EastmoneyJywgToolRequest,
} from "./types.js";

const VERSION = "0.1.0";

const baseInputSchema = {
  profile: z.string().optional().describe("Local eastmoney-jywg profile name. This is not a password or token."),
  account_alias: z.string().optional().describe("Display-only alias for this report."),
  market_session: z.string().optional().describe("Report scope, for example a_share_close."),
  redaction: z.enum(["summary", "exact"]).optional().describe("summary hides total asset exact values; exact should be used only in trusted channels."),
  top_positions_limit: z.number().int().min(0).max(20).optional().describe("How many top gain/loss positions to include."),
};

export interface EastmoneyJywgServerDeps {
  client?: EastmoneyJywgClient;
  loadConfig?: () => EastmoneyJywgConfig;
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

function errorResult(err: unknown) {
  return {
    content: [{ type: "text" as const, text: `eastmoney-jywg error: ${sanitizeError(err)}` }],
    isError: true,
  };
}

function requestProfile(
  request: EastmoneyJywgToolRequest,
  loadConfig: () => EastmoneyJywgConfig,
): EastmoneyJywgProfileConfig {
  return resolveEastmoneyJywgProfile(loadConfig(), request.profile ?? "default", {
    account_alias: request.account_alias,
    redaction: request.redaction,
  });
}

async function buildSnapshot(
  request: EastmoneyJywgToolRequest,
  client: EastmoneyJywgClient,
  loadConfig: () => EastmoneyJywgConfig,
): Promise<{ profile: EastmoneyJywgProfileConfig; snapshot: EastmoneyJywgAccountSnapshot }> {
  const profile = requestProfile(request, loadConfig);
  const session = loadEastmoneyJywgSession(profile.session_secret_path);
  const raw = await client.getRawBrokerData(profile, session, {
    includeOrders: profile.include_orders,
    includeDeals: profile.include_deals,
  });
  return {
    profile,
    snapshot: mapEastmoneyJywgRawBrokerData(raw, profile, request.market_session ?? "unspecified"),
  };
}

function topLimit(value: number | undefined): number {
  if (value === undefined) return 5;
  return Math.max(0, Math.min(20, value));
}

export function createEastmoneyJywgToolHandlers(deps: EastmoneyJywgServerDeps = {}) {
  const client = deps.client ?? new HttpEastmoneyJywgClient();
  const loadConfig = deps.loadConfig ?? loadEastmoneyJywgConfig;
  return {
    async eastmoney_jywg_health_check(request: EastmoneyJywgToolRequest) {
      try {
        const profile = requestProfile(request, loadConfig);
        const session = loadEastmoneyJywgSession(profile.session_secret_path);
        const health = await client.healthCheck(profile, session);
        return textResult(JSON.stringify(health, null, 2), health as unknown as Record<string, unknown>);
      } catch (err) {
        return errorResult(err);
      }
    },

    async eastmoney_jywg_get_account_snapshot(request: EastmoneyJywgToolRequest) {
      try {
        const { profile, snapshot } = await buildSnapshot(request, client, loadConfig);
        const text = redactedSnapshotJson(snapshot, profile);
        return textResult(text, { account_alias: snapshot.account_alias, captured_at: snapshot.captured_at });
      } catch (err) {
        return errorResult(err);
      }
    },

    async eastmoney_jywg_get_positions_summary(request: EastmoneyJywgToolRequest) {
      try {
        const { snapshot } = await buildSnapshot(request, client, loadConfig);
        const positions = topEastmoneyJywgPositionsByPnl(snapshot, topLimit(request.top_positions_limit));
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

    async eastmoney_jywg_get_daily_pnl_report(request: EastmoneyJywgToolRequest) {
      try {
        const { profile, snapshot } = await buildSnapshot(request, client, loadConfig);
        const text = formatEastmoneyJywgDailyPnlReport(snapshot, profile, {
          redaction: request.redaction as EastmoneyJywgRedactionLevel | undefined,
          topPositionsLimit: topLimit(request.top_positions_limit),
        });
        return textResult(text, { account_alias: snapshot.account_alias, captured_at: snapshot.captured_at });
      } catch (err) {
        return errorResult(err);
      }
    },
  };
}

export function createEastmoneyJywgMcpServer(deps: EastmoneyJywgServerDeps = {}): McpServer {
  for (const name of EASTMONEY_JYWG_TOOL_NAMES) assertAllowedToolName(name);
  const handlers = createEastmoneyJywgToolHandlers(deps);
  const server = new McpServer({ name: "eastmoney-jywg", version: VERSION });

  server.registerTool("eastmoney_jywg_health_check", {
    title: "Eastmoney JYWG Health Check",
    description: "Check jywg.18.cn read-only session health without returning cookies or validate keys.",
    inputSchema: baseInputSchema,
  }, handlers.eastmoney_jywg_health_check);

  server.registerTool("eastmoney_jywg_get_account_snapshot", {
    title: "Eastmoney JYWG Account Snapshot",
    description: "Return a redacted Eastmoney account funds snapshot through jywg.18.cn read-only endpoints.",
    inputSchema: baseInputSchema,
  }, handlers.eastmoney_jywg_get_account_snapshot);

  server.registerTool("eastmoney_jywg_get_positions_summary", {
    title: "Eastmoney JYWG Positions Summary",
    description: "Return redacted top position gain/loss summaries through jywg.18.cn read-only endpoints.",
    inputSchema: baseInputSchema,
  }, handlers.eastmoney_jywg_get_positions_summary);

  server.registerTool("eastmoney_jywg_get_daily_pnl_report", {
    title: "Eastmoney JYWG Daily P&L Report",
    description: "Return a Discord-ready, redacted daily P&L report input for MiniClaw tasks.",
    inputSchema: baseInputSchema,
  }, handlers.eastmoney_jywg_get_daily_pnl_report);

  return server;
}

export async function runEastmoneyJywgMcpServer(): Promise<void> {
  const server = createEastmoneyJywgMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEastmoneyJywgMcpServer().catch((err) => {
    console.error(`eastmoney-jywg MCP server failed: ${sanitizeError(err)}`);
    process.exit(1);
  });
}
