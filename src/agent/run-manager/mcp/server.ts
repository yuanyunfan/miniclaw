import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { initDb } from "../../../store/db.js";
import {
  AGENT_ARTIFACT_KINDS,
  AGENT_MESSAGE_KINDS,
  BLACKBOARD_FACT_CONFIDENCES,
  type AgentArtifactKind,
  type AgentMessageKind,
  type BlackboardFactConfidence,
} from "../../../store/agent-run-manager.js";
import { AgentBus } from "../bus.js";

const VERSION = "0.1.0";

export interface AgentBusToolContext {
  taskId: string;
  runId: string;
  cwd: string;
  bus: AgentBus;
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], structuredContent };
}

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

export function createAgentBusToolHandlers(context: AgentBusToolContext) {
  return {
    post_message(input: {
      to_run_id?: string;
      kind: AgentMessageKind;
      content_text?: string;
      payload?: unknown;
      artifact_ids?: string[];
    }) {
      const message = context.bus.sendMessage({
        taskId: context.taskId,
        fromRunId: context.runId,
        ...(input.to_run_id ? { toRunId: input.to_run_id } : {}),
        kind: input.kind,
        ...(input.content_text ? { contentText: input.content_text } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
        ...(input.artifact_ids ? { artifactIds: input.artifact_ids } : {}),
      });
      return textResult(jsonText(message), { message_id: message.id, kind: message.kind });
    },

    read_mailbox(input: { after_cursor?: string }) {
      const messages = context.bus.readMailbox({
        runId: context.runId,
        ...(input.after_cursor ? { afterCursor: input.after_cursor } : {}),
      });
      return textResult(jsonText(messages), { count: messages.length });
    },

    write_artifact(input: {
      kind: AgentArtifactKind;
      title?: string;
      content?: string;
      path?: string;
      summary?: string;
    }) {
      const artifact = context.bus.publishArtifact({
        taskId: context.taskId,
        runId: context.runId,
        kind: input.kind,
        cwd: context.cwd,
        ...(input.title ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.path ? { path: input.path } : {}),
        ...(input.summary ? { summary: input.summary } : {}),
      });
      return textResult(jsonText(artifact), { artifact_id: artifact.id, path: artifact.path });
    },

    read_artifact(input: { artifact_id: string }) {
      const artifact = context.bus.readArtifact(input.artifact_id, context.cwd);
      return textResult(jsonText(artifact ?? null), artifact ? { artifact_id: artifact.artifact.id } : { missing: true });
    },

    list_blackboard() {
      const facts = context.bus.listBlackboard(context.taskId);
      return textResult(jsonText(facts), { count: facts.length });
    },

    upsert_blackboard_fact(input: {
      key: string;
      content: string;
      confidence: BlackboardFactConfidence;
      source_message_id: string;
    }) {
      const fact = context.bus.upsertBlackboardFact({
        taskId: context.taskId,
        key: input.key,
        content: input.content,
        confidence: input.confidence,
        sourceMessageId: input.source_message_id,
      });
      return textResult(jsonText(fact), { key: fact.key, status: fact.status });
    },
  };
}

export function createAgentBusMcpServer(context: AgentBusToolContext): McpServer {
  const handlers = createAgentBusToolHandlers(context);
  const server = new McpServer({ name: "miniclaw-agent-bus", version: VERSION });

  server.registerTool("post_message", {
    title: "Post Agent Message",
    description: "Post a typed message from the current managed run through MiniClaw Agent Bus.",
    inputSchema: {
      to_run_id: z.string().optional(),
      kind: z.enum(AGENT_MESSAGE_KINDS),
      content_text: z.string().optional(),
      payload: z.unknown().optional(),
      artifact_ids: z.array(z.string()).optional(),
    },
  }, (input) => handlers.post_message({
    ...input,
    artifact_ids: stringArray(input.artifact_ids),
  }));

  server.registerTool("read_mailbox", {
    title: "Read Agent Mailbox",
    description: "Read durable mailbox messages for the current managed run.",
    inputSchema: { after_cursor: z.string().optional() },
  }, handlers.read_mailbox);

  server.registerTool("write_artifact", {
    title: "Write Agent Artifact",
    description: "Write or reference a managed run artifact.",
    inputSchema: {
      kind: z.enum(AGENT_ARTIFACT_KINDS),
      title: z.string().optional(),
      content: z.string().optional(),
      path: z.string().optional(),
      summary: z.string().optional(),
    },
  }, handlers.write_artifact);

  server.registerTool("read_artifact", {
    title: "Read Agent Artifact",
    description: "Read a managed run artifact by id.",
    inputSchema: { artifact_id: z.string() },
  }, handlers.read_artifact);

  server.registerTool("list_blackboard", {
    title: "List Blackboard Facts",
    description: "List active blackboard facts for the current task.",
    inputSchema: {},
  }, handlers.list_blackboard);

  server.registerTool("upsert_blackboard_fact", {
    title: "Upsert Blackboard Fact",
    description: "Create or update a task-scoped blackboard fact.",
    inputSchema: {
      key: z.string(),
      content: z.string(),
      confidence: z.enum(BLACKBOARD_FACT_CONFIDENCES),
      source_message_id: z.string(),
    },
  }, handlers.upsert_blackboard_fact);

  return server;
}

export async function runAgentBusMcpServerFromEnv(): Promise<void> {
  const taskId = process.env.MINICLAW_AGENT_BUS_TASK_ID;
  const runId = process.env.MINICLAW_AGENT_BUS_RUN_ID;
  const cwd = process.env.MINICLAW_AGENT_BUS_CWD ?? process.cwd();
  if (!taskId || !runId) {
    throw new Error("MINICLAW_AGENT_BUS_TASK_ID and MINICLAW_AGENT_BUS_RUN_ID are required");
  }
  initDb();
  const server = createAgentBusMcpServer({ taskId, runId, cwd, bus: new AgentBus() });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAgentBusMcpServerFromEnv().catch((err) => {
    process.stderr.write(`miniclaw-agent-bus MCP server failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
