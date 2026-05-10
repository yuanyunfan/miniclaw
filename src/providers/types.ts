export interface PreProviderRunArgs {
  configName?: string;
  jobName: string;
  channelId: string;
  runAt: Date;
}

export interface PreProviderAttachment {
  path: string;
  name?: string;
  description?: string;
}

export interface PreProviderResult {
  text: string;
  /**
   * Optional files generated from structured provider data. Cron task runners
   * upload these after the LLM report so providers can attach charts/screenshots
   * without asking the LLM to create or parse binary output.
   */
  attachments?: PreProviderAttachment[];
  /**
   * Optional guard for scheduled tasks: when present, the cron runner logs the
   * reason and skips the downstream LLM task.
   */
  skipTask?: {
    reason: string;
    message?: string;
    /**
     * Optional user-facing Discord notice for actionable skips, such as an
     * expired login session. Omit it for quiet "no new data" skips.
     */
    notifyMessage?: string;
  };
  /**
   * Called only after the downstream cron task has completed successfully.
   * Providers should use this for state mutation such as marking items as sent.
   */
  commit?: () => Promise<void>;
}

export type PreProviderRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;
