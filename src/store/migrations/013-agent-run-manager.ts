import type { SchemaMigration } from "./types.js";

export const migration013AgentRunManager: SchemaMigration = {
  version: 13,
  name: "013_agent_run_manager",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        parent_run_id TEXT,
        controller_run_id TEXT,
        requester_run_id TEXT,
        role TEXT NOT NULL,
        runtime TEXT NOT NULL,
        provider_session_id TEXT,
        status TEXT NOT NULL,
        spawn_depth INTEGER NOT NULL DEFAULT 0,
        control_scope TEXT NOT NULL,
        context_mode TEXT NOT NULL DEFAULT 'isolated',
        cwd TEXT NOT NULL,
        tool_policy_id TEXT NOT NULL,
        can_spawn INTEGER NOT NULL DEFAULT 0,
        can_write_workspace INTEGER NOT NULL DEFAULT 0,
        can_send_kinds_json TEXT NOT NULL DEFAULT '[]',
        can_receive_kinds_json TEXT NOT NULL DEFAULT '[]',
        route_json TEXT,
        prompt_context_hash TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        error_message TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (parent_run_id) REFERENCES agent_runs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_runs_task_status_created
        ON agent_runs(task_id, status, started_at);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_parent_status
        ON agent_runs(parent_run_id, status);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_requester_status
        ON agent_runs(requester_run_id, status);

      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        from_run_id TEXT NOT NULL,
        to_run_id TEXT,
        kind TEXT NOT NULL,
        content_text TEXT,
        payload_json TEXT,
        artifact_ids_json TEXT NOT NULL DEFAULT '[]',
        causal_message_id TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (from_run_id) REFERENCES agent_runs(id),
        FOREIGN KEY (to_run_id) REFERENCES agent_runs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_messages_task_created
        ON agent_messages(task_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_to_created
        ON agent_messages(to_run_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_agent_messages_from_created
        ON agent_messages(from_run_id, created_at);

      CREATE TABLE IF NOT EXISTS blackboard_facts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        confidence TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (source_message_id) REFERENCES agent_messages(id),
        UNIQUE(task_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_blackboard_facts_task_key_status
        ON blackboard_facts(task_id, key, status);

      CREATE TABLE IF NOT EXISTS agent_artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        title TEXT,
        summary TEXT,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (run_id) REFERENCES agent_runs(id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_artifacts_task_run_created
        ON agent_artifacts(task_id, run_id, created_at);
    `);
  },
};
