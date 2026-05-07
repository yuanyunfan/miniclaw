import type { PreProviderResult, PreProviderRunArgs } from "../types.js";
import { searchEmailMessages } from "../../capabilities/email/query.js";
import { isEmailMessageSeen, loadEmailState, markEmailMessagesSeen, saveEmailState } from "../../capabilities/email/state.js";
import { loadEmailQueryProviderConfig } from "./config.js";
import { formatEmailQueryProviderResult } from "./format.js";

export async function runEmailQueryProvider(args: PreProviderRunArgs): Promise<PreProviderResult> {
  const config = loadEmailQueryProviderConfig(args.configName);
  const windowEnd = args.runAt;
  const windowStart = new Date(windowEnd.getTime() - config.window_hours * 3600_000);
  const state = loadEmailState(config.state_path);
  const result = await searchEmailMessages({
    profile: config.email_profile,
    folders: config.folders,
    from: config.from,
    subject_includes: config.subject_includes,
    received_after: windowStart.toISOString(),
    received_before: windowEnd.toISOString(),
    max_results: config.max_results,
    include_body: config.include_body,
    include_attachments: config.include_attachments,
  });

  const messages = config.dedupe
    ? result.messages.filter((message) => !isEmailMessageSeen(state, message))
    : result.messages;
  const skippedDuplicates = result.messages.length - messages.length;
  const filtered = { ...result, messages };
  return {
    text: formatEmailQueryProviderResult(filtered, {
      windowStart,
      windowEnd,
      skippedDuplicates,
      includeBody: config.include_body,
    }),
    commit: async () => {
      if (!config.dedupe) return;
      markEmailMessagesSeen(state, messages);
      saveEmailState(config.state_path, state);
    },
  };
}
