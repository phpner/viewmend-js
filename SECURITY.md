# Security policy

## Supported versions

| Version | Security support |
| --- | --- |
| 1.x | Supported |
| Earlier | Not supported |

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Email [support@viewmend.com](mailto:support@viewmend.com) with the subject `Security report: @viewmend/sdk`.

Include:

- the affected package version;
- the runtime and minimal reproduction;
- the security impact and likely attack path;
- any suggested mitigation;
- whether disclosure is time-sensitive.

Do not include live ViewMend API tokens, Authorization headers, customer payloads, or personal data. Use clearly synthetic values in a reproduction.

ViewMend will acknowledge a complete report as soon as practical, investigate it, and coordinate remediation and disclosure with the reporter. Product support questions that do not involve a vulnerability can use the same address without the security-report subject.

## Credential safety

`@viewmend/sdk` is for trusted server-side and serverless code. A ViewMend API token must never be embedded in a browser bundle, public environment variable, client-visible error, fixture, snapshot, source map, or repository secret.
