# MiniClaw Agent Rules

## Website Update Policy

- Treat `website/**` as a curated public portal, not an implementation log.
- For small fixes, update code, focused tests, canonical `docs/**`, and `CHANGELOG.md`; do not edit website body text unless the public summary becomes inaccurate.
- Update website pages only for public-facing capability changes, install/config workflow changes, clearly user-visible behavior changes, or stale website claims.
- Keep implementation details, edge cases, code paths, Discord embed/chunk behavior, and test coverage notes in canonical repo docs or changelog entries.
- If `quality:website-docs` reports a source-doc change but the website summary is still accurate, use the website drift acknowledgement path instead of adding low-level details to website copy.
