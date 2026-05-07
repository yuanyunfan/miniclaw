import { stripBodyForOutput } from "../../capabilities/email/redaction.js";
import type { EmailMessage, EmailSearchResult } from "../../capabilities/email/types.js";

export interface EmailQueryProviderOutput {
  generated_at: string;
  profile: string;
  window_start: string;
  window_end: string;
  message_count: number;
  skipped_duplicates: number;
  messages: Array<Record<string, unknown>>;
  warnings: string[];
}

export function formatEmailQueryProviderResult(
  result: EmailSearchResult,
  params: {
    windowStart: Date;
    windowEnd: Date;
    skippedDuplicates: number;
    includeBody: boolean;
  },
): string {
  const messages = result.messages.map((message: EmailMessage) => {
    const redacted = stripBodyForOutput(message);
    if (params.includeBody) return redacted;
    const { snippet: _snippet, text_excerpt: _textExcerpt, ...withoutBody } = redacted;
    return withoutBody;
  });
  const output: EmailQueryProviderOutput = {
    generated_at: result.generated_at,
    profile: result.profile,
    window_start: params.windowStart.toISOString(),
    window_end: params.windowEnd.toISOString(),
    message_count: messages.length,
    skipped_duplicates: params.skippedDuplicates,
    messages,
    warnings: result.warnings,
  };
  return JSON.stringify(output, null, 2);
}
