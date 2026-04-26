module.exports = {
  apps: [
    {
      name: "miniclaw",
      script: "npx",
      args: "tsx src/index.ts",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      watch: false,
      max_memory_restart: "500M",
      exp_backoff_restart_delay: 1000,
      max_restarts: 10,
    },
  ],
};
