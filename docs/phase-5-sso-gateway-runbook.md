# Phase 5 SSO gateway runbook

This runbook operationalizes the normalized-header boundary fixed by D-10 in
[`phase-5-d10-sso-rbac.md`](phase-5-d10-sso-rbac.md). The gateway owns OIDC Authorization Code +
PKCE, token validation and browser session/CSRF controls. PCM never receives an IdP token.

## Runtime configuration

Production requires:

```text
PCM_ENVIRONMENT=production
PCM_AUTH_MODE=trusted_proxy
PCM_AUTH_ISSUER=<exact normalized issuer>
PCM_AUTH_PROXY_SECRETS=["<unpadded-base64url 32..256 decoded bytes>"]
PCM_AUTH_ADMIN_GROUPS=["<group>"]
PCM_AUTH_REVIEWER_GROUPS=["<group>"]
PCM_AUTH_EDITOR_GROUPS=["<group>"]
```

Use one secret normally and two only during rotation. Group arrays must be nonempty, disjoint arrays
of nonempty UTF-8 strings. `dev_stub` is allowed only in `development` and `test`.

## Gateway request contract

Strip every inbound `X-PCM-*` header before authentication, then inject exactly one value for each
required header. Subject, groups, display name and email use strict unpadded base64url; decoded text
is UTF-8. `X-PCM-Groups` decodes to a JSON string array. State-changing requests also inject
`X-PCM-CSRF-Verified: 1` after the gateway verifies its session-bound CSRF proof.

Never forward public traffic directly to the PCM application port. Network policy must restrict the
application listener to the gateway identity. PCM returns one public `401 authentication_required`
shape for every identity/trust parse failure and does not disclose which proof failed.

## Readiness and rotation

1. Deploy PCM with both old and new proxy secrets.
2. Confirm `/ready` is healthy and `/api/auth/me` succeeds through the gateway with the new secret.
3. Switch all gateway instances to the new secret.
4. Remove the old secret from PCM and confirm readiness again.

Malformed auth configuration keeps the process alive but fails readiness and protected routes closed
with `503 auth_not_configured`. Do not bypass readiness during rotation.

## Tenant conformance

Run the tenant smoke cases recorded in
`docs/evidence/phase-5-sso-tenant-conformance.json`: editor/reviewer/admin mapping, Unicode
presentation fields, duplicate/forged headers, issuer mismatch, secret mismatch, CSRF failure, and
logout/session expiry. The repository artifact remains `pending` until a real tenant and gateway are
available; unit or mocked browser tests are not a substitute.
