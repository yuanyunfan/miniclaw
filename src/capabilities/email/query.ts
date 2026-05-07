import { loadEmailConfig, loadEmailSecret, resolveEmailProfile } from "./config.js";
import { ImapEmailClient } from "./clients/imap.js";
import type { EmailClient, EmailConfig, EmailProfileConfig, EmailQuery, EmailSearchResult } from "./types.js";

export function createEmailClient(profile: EmailProfileConfig): EmailClient {
  if (profile.provider === "imap") {
    return new ImapEmailClient(profile, loadEmailSecret(profile));
  }
  throw new Error(`email provider '${profile.provider}' is not implemented yet`);
}

export async function searchEmailMessages(
  query: EmailQuery,
  options: { config?: EmailConfig; client?: EmailClient } = {},
): Promise<EmailSearchResult> {
  const config = options.config ?? loadEmailConfig();
  const profile = resolveEmailProfile(config, query.profile);
  const client = options.client ?? createEmailClient(profile);
  return await client.search(query);
}
