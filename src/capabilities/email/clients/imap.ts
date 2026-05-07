import { ImapFlow, type FetchMessageObject, type ImapFlowOptions, type MessageAddressObject, type SearchObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailAddress, EmailClient, EmailHealth, EmailMessage, EmailQuery, EmailSearchResult, EmailSecret, EmailProfileConfig } from "../types.js";
import { hashValue, matchesAddressPattern, sanitizeEmailError, subjectMatches } from "../redaction.js";

function toAddress(address?: MessageAddressObject): EmailAddress {
  return {
    name: address?.name,
    address: address?.address,
  };
}

function normalizeDate(value: Date | string | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function maxResults(query: EmailQuery, profile: EmailProfileConfig): number {
  const value = query.max_results ?? profile.max_results;
  return Math.max(1, Math.min(500, value));
}

function defaultReceivedAfter(profile: EmailProfileConfig): string {
  return new Date(Date.now() - profile.max_lookback_days * 24 * 3600_000).toISOString();
}

function buildSearchObject(query: EmailQuery, profile: EmailProfileConfig): SearchObject {
  const search: SearchObject = {
    since: new Date(query.received_after ?? defaultReceivedAfter(profile)),
  };
  if (query.received_before) search.before = new Date(query.received_before);
  return search;
}

function queryFolders(query: EmailQuery, profile: EmailProfileConfig): string[] {
  const folders = query.folders?.length ? query.folders : profile.folders;
  return [...new Set(folders.map((folder) => folder.trim()).filter(Boolean))];
}

function querySenderPatterns(query: EmailQuery, profile: EmailProfileConfig): string[] {
  return query.from?.length ? query.from : profile.allowed_senders;
}

function querySubjectIncludes(query: EmailQuery, profile: EmailProfileConfig): string[] {
  return query.subject_includes?.length ? query.subject_includes : profile.subject_allowlist;
}

function imapOptions(profile: EmailProfileConfig, secret: EmailSecret): ImapFlowOptions {
  if (!profile.imap) throw new Error(`email profile '${profile.name}' is not configured for IMAP`);
  const user = secret.username ?? secret.user ?? profile.imap.user;
  const pass = secret.password ?? secret.pass;
  const accessToken = secret.access_token;
  if (!user) throw new Error(`email profile '${profile.name}' IMAP secret missing username`);
  if (!pass && !accessToken) throw new Error(`email profile '${profile.name}' IMAP secret missing password/access_token`);
  return {
    host: profile.imap.host,
    port: profile.imap.port,
    secure: profile.imap.secure,
    auth: {
      user,
      ...(pass ? { pass } : {}),
      ...(accessToken ? { accessToken } : {}),
      ...(profile.imap.login_method ? { loginMethod: profile.imap.login_method } : {}),
    },
    tls: { rejectUnauthorized: profile.imap.tls_reject_unauthorized },
    logger: false,
    clientInfo: { name: "MiniClaw", version: "0.4" },
  };
}

export class ImapEmailClient implements EmailClient {
  constructor(
    private readonly profile: EmailProfileConfig,
    private readonly secret: EmailSecret,
  ) {}

  async healthCheck(): Promise<EmailHealth> {
    const client = new ImapFlow({ ...imapOptions(this.profile, this.secret), verifyOnly: true });
    try {
      await client.connect();
      return { ok: true, provider: "imap", account_alias: this.profile.account_alias };
    } catch (err) {
      return { ok: false, provider: "imap", account_alias: this.profile.account_alias, error: sanitizeEmailError(err) };
    } finally {
      client.close();
    }
  }

  async search(query: EmailQuery): Promise<EmailSearchResult> {
    const warnings: string[] = [];
    const client = new ImapFlow(imapOptions(this.profile, this.secret));
    const messages: EmailMessage[] = [];
    const limit = maxResults(query, this.profile);
    const folders = queryFolders(query, this.profile);
    const senderPatterns = querySenderPatterns(query, this.profile);
    const subjectIncludes = querySubjectIncludes(query, this.profile);
    const includeBody = query.include_body === true;
    const includeAttachments = query.include_attachments === true || this.profile.attachment_policy === "metadata_only";

    try {
      await client.connect();
      for (const folder of folders) {
        if (messages.length >= limit) break;
        await client.mailboxOpen(folder, { readOnly: true });
        const found = await client.search(buildSearchObject(query, this.profile), { uid: true });
        const uids = Array.isArray(found) ? found.sort((a, b) => b - a) : [];
        const scanLimit = Math.min(uids.length, Math.max(limit * 5, limit));
        const fetchRange = uids.slice(0, scanLimit);
        if (!fetchRange.length) continue;
        for await (const item of client.fetch(fetchRange, {
          uid: true,
          envelope: true,
          internalDate: true,
          source: includeBody || includeAttachments ? { maxLength: this.profile.body_max_bytes } : false,
        }, { uid: true })) {
          if (messages.length >= limit) break;
          const message = await this.toMessage(folder, item, { includeBody, includeAttachments });
          if (!matchesAddressPattern(message.from.address, senderPatterns)) continue;
          if (!subjectMatches(message.subject, subjectIncludes)) continue;
          if (query.received_before && new Date(message.received_at) >= new Date(query.received_before)) continue;
          messages.push(message);
        }
      }
    } catch (err) {
      throw new Error(sanitizeEmailError(err));
    } finally {
      await client.logout().catch(() => client.close());
    }

    if (!messages.length) {
      warnings.push("No email messages matched the query window and filters.");
    }
    return {
      profile: this.profile.name,
      generated_at: new Date().toISOString(),
      query: {
        folders,
        received_after: query.received_after,
        received_before: query.received_before,
        max_results: limit,
      },
      messages,
      warnings,
    };
  }

  private async toMessage(
    folder: string,
    item: FetchMessageObject,
    options: { includeBody: boolean; includeAttachments: boolean },
  ): Promise<EmailMessage> {
    const envelope = item.envelope;
    const from = toAddress(envelope?.from?.[0]);
    const to = envelope?.to?.map(toAddress) ?? [];
    const subject = envelope?.subject ?? "";
    const messageId = envelope?.messageId || `${folder}:${item.uid}:${subject}:${normalizeDate(item.internalDate)}`;
    const base: EmailMessage = {
      id: `imap:${this.profile.name}:${folder}:${item.uid}`,
      profile: this.profile.name,
      folder,
      provider_uid: String(item.uid),
      message_id_hash: hashValue(messageId),
      thread_id: item.threadId,
      received_at: normalizeDate(item.internalDate ?? envelope?.date),
      from,
      to,
      subject,
      attachments: [],
    };

    if (!item.source || (!options.includeBody && !options.includeAttachments)) {
      return base;
    }

    const parsed = await simpleParser(item.source);
    const text = normalizeText(parsed.text);
    return {
      ...base,
      subject: parsed.subject ?? subject,
      from: {
        name: parsed.from?.value[0]?.name ?? from.name,
        address: parsed.from?.value[0]?.address ?? from.address,
      },
      to: parsed.to && "value" in parsed.to
        ? parsed.to.value.map((entry) => ({ name: entry.name, address: entry.address }))
        : to,
      snippet: text?.slice(0, 300),
      ...(options.includeBody ? { text, html: normalizeText(parsed.html || undefined) } : {}),
      attachments: options.includeAttachments
        ? parsed.attachments.map((attachment) => ({
          filename: attachment.filename,
          content_type: attachment.contentType,
          size: attachment.size,
          checksum: attachment.checksum,
        }))
        : [],
    };
  }
}
