# Contributing to the ViewMend JavaScript SDK

Thank you for helping improve `@viewmend/sdk`.

## Before opening a change

- Use a supported Node.js version: 22, 24, or 26.
- Discuss new public methods, event fields, wire-contract changes, or runtime claims in an issue before implementation.
- Never add an API field because another integration or provider happens to use it. Public event fields must match the current ViewMend Site Tracker Events API.
- Keep API tokens and real customer payloads out of tests, fixtures, issues, commits, and build output.

Security vulnerabilities must not be reported in a public issue. Follow [SECURITY.md](SECURITY.md).

## Local setup

```bash
npm ci
npm run quality
```

The package intentionally has no runtime dependencies. A production dependency requires a concrete compatibility or security justification.

## Change expectations

- Keep module access through `ViewMend.siteTracker()` and `ViewMend.cron()`, preserving existing event methods.
- Keep the shared path compatible with standard fetch, `Request`, `Response`, and `AbortSignal` APIs.
- Add or update contract tests for every wire change.
- Test both accepted and duplicate delivery behavior when changing event sending.
- Keep errors bounded and free of authorization headers, tokens, raw bodies, or transport exception text.
- Update README runtime claims only after a repeatable build or runtime test is part of CI.
- Add an entry to `CHANGELOG.md` for user-visible changes.

## Pull requests

A pull request should explain the user-visible problem, the selected API behavior, contract evidence, and exact checks run. Keep unrelated formatting or refactors out of the change.

By contributing, you agree that your contribution is licensed under the project's MIT License.
