# Email Capability Foundation

Status: completed
Date: 2026-05-07

## Background

The user wants MiniClaw to read daily credit card notification emails and summarize spending to Discord. This should not be implemented as a one-off CMB credit card scraper. Email access is a reusable sensitive data capability that can later support bills, invoices, travel emails, subscription newsletters, and other structured workflows.

Existing MiniClaw cron jobs support `pre_provider`, where a provider collects structured data before an LLM task summarizes it. The WeChat provider is the current example.

## Goals

- Add a reusable, read-only `src/capabilities/email` foundation.
- Keep mailbox credentials outside repo and outside provider YAML.
- Support a practical first adapter: read-only IMAP.
- Add a generic `email-query` pre-provider for controlled mailbox queries.
- Add a CMB credit card email consumer that parses transaction notification emails from the email capability.
- Default to no raw email body retention and no write/delete/send mailbox operations.
- Add focused tests for config parsing, redaction, state, CMB parsing, and provider formatting.

## Non-Goals

- Do not implement Gmail OAuth or Microsoft Graph OAuth in this slice.
- Do not implement email send, delete, move, mark-read, reply, or forward.
- Do not create a live user mailbox cron job without the user providing a dedicated mailbox/profile.
- Do not parse every possible CMB email template perfectly before seeing real samples.

## Existing Architecture Evidence

- `src/providers/types.ts`: `PreProviderRunner` contract.
- `src/providers/index.ts`: provider registry.
- `src/cron/runner-task.ts`: `pre_provider` output is prepended to task prompt.
- `src/providers/wechat-mp/*`: prior structured provider pattern.
- `docs/plans/README.md`: durable plan required for changes to auth/data flow/provider execution.

## Implementation Plan

1. Add `src/capabilities/email`:
   - typed profile config and secrets loading;
   - IMAP read-only client;
   - message query model;
   - redaction helpers;
   - state helpers for message-level dedupe.
2. Add `src/providers/email-query`:
   - generic controlled query provider;
   - output redacted compact JSON.
3. Add `src/providers/cmb-credit-card-email`:
   - load business config;
   - query emails through the email capability;
   - parse transaction records;
   - dedupe by transaction hash;
   - output Discord/LLM-safe structured JSON.
4. Register providers in `src/providers/index.ts`.
5. Add documentation:
   - generic Email capability;
   - CMB credit card email consumer setup and limitations.
6. Run build and test suite.

## Verification Plan

- Type check: `pnpm build`
- Focused tests: new capability/provider test files.
- Full test suite: `pnpm test`
- Static safety checks:
  - no email credentials in repo examples;
  - no write/delete/send mailbox methods exposed;
  - provider output does not include raw body by default.

## Risks And Rollback

- Risk: IMAP server differences can break live mailbox reads.
  - Mitigation: keep adapter isolated and tested through interface-level logic; add live smoke only after user provides mailbox details.
- Risk: CMB email templates vary.
  - Mitigation: parser is conservative and sample-driven; unparsed messages are reported as warnings.
- Risk: exposing mailbox content to LLM.
  - Mitigation: default provider output is structured, redacted, and body-free.
- Rollback: remove `email-query` / `cmb-credit-card-email` from provider registry and delete the new capability/provider directories.

## Documentation Sync

- Add `docs/email-capability.md`.
- Add `docs/cmb-credit-card-email.md`.
- Update `docs/architecture.md` with the new base capability.

## Execution Notes

- Added `src/capabilities/email` with profile config loading, secret loading, read-only IMAP search, MIME parsing, redaction, and message dedupe state.
- Added `email-query` and `cmb-credit-card-email` pre-providers.
- Registered both providers in `src/providers/index.ts`.
- Added focused tests for config, state, redaction, formatting, parsing, and collector behavior.
- Added documentation for the generic Email capability and the CMB credit-card email consumer.
