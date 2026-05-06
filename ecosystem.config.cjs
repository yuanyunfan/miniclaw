const { homedir } = require("os");
const { join } = require("path");
const { mkdirSync } = require("fs");

const logDir = process.env.MINICLAW_LOG_DIR || join(homedir(), ".miniclaw", "logs");
mkdirSync(logDir, { recursive: true });

module.exports = {
  apps: [
    {
      name: "miniclaw",
      script: "dist/index.js",
      interpreter: "node",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      filter_env: [
        "ANTHROPIC_",
        "CODEX_",
        "OPENAI_",
        "OPENAPI_MCP_HEADERS",
        "RAVEN_",
        "TAVILY_",
      ],
      watch: false,
      max_memory_restart: "500M",
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
      out_file: join(logDir, "miniclaw-out.log"),
      error_file: join(logDir, "miniclaw-error.log"),
      merge_logs: true,
      time: false, // logger 自己打 ISO 时间戳，避免 pm2 再加一层
    },
  ],
};
