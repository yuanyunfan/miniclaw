export interface PreProviderRunArgs {
  configName?: string;
  jobName: string;
  channelId: string;
  runAt: Date;
}

export interface PreProviderResult {
  text: string;
  /**
   * Called only after the downstream cron task has completed successfully.
   * Providers should use this for state mutation such as marking items as sent.
   */
  commit?: () => Promise<void>;
}

export type PreProviderRunner = (args: PreProviderRunArgs) => Promise<PreProviderResult>;
