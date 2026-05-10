export interface PreProviderRunArgs {
  configName?: string;
  jobName: string;
  channelId: string;
  runAt: Date;
}

export interface PreProviderResult {
  text: string;
  /**
   * Optional guard for scheduled tasks: when present, the cron runner logs the
   * reason and skips the downstream LLM task without sending a Discord message.
   */
  skipTask?: {
    reason: string;
    message?: string;
  };
  /**
   * Called only after the downstream cron task has completed successfully.
   * Providers should use this for state mutation such as marking items as sent.
   */
  commit?: () => Promise<void>;
}

export type PreProviderRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;
