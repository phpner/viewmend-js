# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-09-05

### Added

- Site Tracker `dashboard()` and `resources()` with page/device selection, explicit resource pagination, deeply immutable typed responses, validated RFC 3339 timestamps, and dedicated read errors, matching PHP SDK 1.3.0.
- Neutral Cron registration, current settings, and disable operations, including self-hosted/local API configuration and separate token-scope errors.
- Offline HMAC-SHA256 Cron callback verification with raw-byte snapshots, connection/run binding, duplicate-header rejection, freshness validation, and verification challenge responses.
- Dashboard/resources wire fixtures, Cron contract and callback tests, and expanded packed ESM/CommonJS/TypeScript consumer checks.

### Changed

- Shared transport supports safe GET/PUT/DELETE operations alongside existing event POSTs; redirects are disabled and request bodies remain identical across retries.
- Cron `current()` returns null only for a documented `registration_not_found` response; unrelated 404 failures remain errors.
- Existing event methods remain compatible. The SDK still has zero runtime dependencies.

## [1.0.0] - 2026-08-18

### Added

- Official TypeScript-first `@viewmend/sdk` client for server-side JavaScript.
- Site Tracker helpers for deployment, content, plugin, theme, cache, tracking-script, maintenance, and custom events.
- Fetch-based transport with Bearer authentication, timeout, caller cancellation, bounded retries, and `Retry-After` support.
- Strict local validation, stable-event duplicate behavior, typed delivery results, forward-compatible queue statuses, and redacted typed errors.
- ESM and CommonJS distributions with declarations and source maps.
- Node.js 22, 24, and 26 quality matrix, packed-package consumer tests, and OIDC trusted-publishing release preparation.

[1.1.0]: https://github.com/phpner/viewmend-js/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/phpner/viewmend-js/releases/tag/v1.0.0
