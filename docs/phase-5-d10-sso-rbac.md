# D-10 — SSO, IdP integration, user/authorization identity contract

- **Status:** approved (Architect v3 → Critic v2, 2026-07-19)
- **Date:** 2026-07-19
- **Context:** `.omx/context/phase-5-approval-revision-20260719T124723Z.md`

## Decision

PCM production authentication uses an **OIDC-aware trusted SSO gateway / reverse proxy**. The
gateway executes OIDC Authorization Code flow with PKCE against the corporate IdP, owns the browser
session, strips inbound `X-PCM-*` identity headers, and injects a normalized identity into a
network-private backend upstream. PCM holds no IdP access/refresh token and does not implement a
browser OIDC client.

PCM has two explicit modes:

1. `dev_stub`: local/test fixed identity; production refuses it.
2. `trusted_proxy`: production, fail closed on missing/invalid proxy credential or identity.

Configuration is explicit:

- `PCM_ENVIRONMENT=development|test|production` and `PCM_AUTH_MODE=dev_stub|trusted_proxy`.
- `dev_stub` is valid only in development/test. Any invalid production auth configuration makes
  `/health/ready` fail and every protected request return `503 auth_not_configured`; liveness remains
  independent.
- `PCM_AUTH_PROXY_SECRETS` is a JSON array of one or two distinct, unpadded base64url strings that
  decode to 32..256 random bytes. The gateway sends that header-safe encoded value. During rotation
  either secret is accepted with constant-time comparison; removal requires config reload.
- issuer is one non-empty exact value. Admin/reviewer/editor group mappings are JSON string arrays,
  each non-empty in production, with no duplicate/overlapping group across roles. A server mapping
  omission is invalid config; a valid user claim containing no mapped group is a valid no-role user.
- Config changes require reload/restart. IdP membership changes appear only after the gateway refreshes
  its session claims.

### Proxy-to-application contract

| Header | Required | Contract |
|---|---:|---|
| `X-PCM-Proxy-Secret` | yes | High-entropy transport credential; constant-time compared; never returned/logged. Direct backend ingress is also denied by network policy. |
| `X-PCM-Subject` | yes | Strict unpadded base64url of stable IdP `sub` UTF-8 bytes (decoded 1..255 bytes). PCM audit ID is `oidc:` + lowercase SHA-256 hex of `issuer UTF-8 + NUL + decoded sub bytes` (69 chars). Email/display name are never identity. |
| `X-PCM-Groups` | yes | Base64url JSON string array; unique entries, at most 100 groups and 8 KiB decoded. Empty is valid. |
| `X-PCM-Display-Name` | no | Strict unpadded base64url of UTF-8; decoded at most 512 bytes / 255 Unicode scalars. Presentation only. |
| `X-PCM-Email` | no | Strict unpadded base64url of UTF-8; decoded at most 320 bytes/scalars. Presentation only; never authorizes. |
| `X-PCM-Issuer` | yes | Exact configured corporate issuer identifier. |
| `X-PCM-CSRF-Verified` | unsafe methods | Exact `1`, injected only after gateway CSRF/Origin verification. |

The gateway validates issuer, audience/client, signature, expiry, nonce/state and PKCE before
injecting headers. PCM validates its boundary again: issuer, proxy secret, sizes, encoding, element
types and control characters; Subject/display/email decode as strict UTF-8. Gateway-to-backend requests must be private and encrypted (or same-host
private overlay), with all client identity headers stripped and replaced.

Every contract header must occur exactly once when required; duplicate header fields are rejected even
if values match. `X-PCM-Groups` raw length is at most 12 KiB, uses only unpadded base64url alphabet,
decodes to at most 8 KiB of strict UTF-8 JSON, and contains unique group strings of 1..256 characters.
All identity text rejects NUL/control characters. Any identity parsing/trust failure returns the same
safe `401 authentication_required` shape.

### Browser session and CSRF boundary

The gateway session cookie is `__Host-pcm_session`, `Secure`, `HttpOnly`, `Path=/`, has no `Domain`, and
uses `SameSite=Lax` (compatible with top-level OIDC redirects). CORS is disabled except the exact PCM
origin; gateway Host/Origin allowlists reject cross-origin unsafe methods and gateway CSRF protection
must validate a token/proof before injecting `X-PCM-CSRF-Verified: 1`. PCM requires that exact, single
header on `POST`, `PUT`, `PATCH`, and `DELETE` **in `trusted_proxy` mode**. `dev_stub` bypasses only
this gateway assertion and is unreachable in production. Client attempts to inject it are stripped.
The gateway owns token generation/rotation; PCM does not introduce a second browser token lifecycle.

### Role source

IdP group claims are the **only production role source** in Phase 5. There is no local user/role
assignment table. Exact, case-sensitive groups map by configuration:

- `PCM_AUTH_ADMIN_GROUPS` → `admin`
- `PCM_AUTH_REVIEWER_GROUPS` → `reviewer`
- `PCM_AUTH_EDITOR_GROUPS` → `editor`

Unknown groups are ignored; multiple roles union permissions. An authenticated user with no mapped
role may call `GET /api/auth/me`; business APIs return `403 permission_denied`. PCM group-map changes
apply after process reload/restart; user-claim changes apply on the first request after gateway session
refresh. Neither rewrites historical actor IDs.

### User and permission contract

```text
UserContext {
  id: string              # computed oidc:<64 lowercase hex>; audit actor
  display_name?: string   # presentation only
  email?: string          # presentation only
  roles: tuple[Role, ...] # deterministic order
  permissions: tuple[Permission, ...] # derived by server only
}
```

| Capability | admin | reviewer | editor |
|---|:---:|:---:|:---:|
| read project/registry/history/validation/comments | ✓ | ✓ | ✓ |
| manage parameter/category/ChoiceSet/validation rule | ✓ | – | – |
| create project / edit Draft / acquire edit lock | ✓ | – | ✓ |
| request Review / return Rejected to Draft | ✓ | – | ✓ |
| approve or reject Review | ✓ | ✓ | – |
| create Revision from Approved | ✓ | – | ✓ |
| create/resolve comments | ✓ | ✓ | ✓ |
| Phase 6 output (reserved) | ✓ | ✓ | ✓ |

There is no four-eyes/self-approval rule because the requirements do not define one. Actor IDs are
captured so a later governance rule can be added without losing evidence. UI permissions are
affordances only; backend dependencies enforce every permission.

`business.read` is the common read permission. It covers process ingest reads; parameter/category/
ChoiceSet/rule reads and dry-run previews; project/backbone preview/list/detail; sheet, Profile,
history, validation, backbone diff and comment reads. All mapped roles receive it. `/api/auth/me` is
the only business no-role exception. Evaluation precedence is authentication `401`, permission `403`,
then resource/status/lock errors. Roles order `admin, reviewer, editor`; permissions use declaration
order, with duplicates removed.

### Errors and deployment

- `401 authentication_required`: missing/malformed/untrusted identity.
- `403 permission_denied`: authenticated but missing permission; disclose only
  `required_permission`, never raw groups or credentials.
- `503 auth_not_configured`: production auth mode/configuration invalid.
- `/api/auth/me` returns presentation identity, roles and permissions, never raw groups/secret.
- Production must refuse `dev_stub`, deny direct backend ingress, redact identity transport headers,
  and rotate the proxy secret independently of IdP credentials.
- Real tenant/gateway values are deployment configuration. The repository supplies a normalized
  identity/CSRF conformance harness; tenant smoke remains externally credential-gated.

Settings parsing itself never raises for auth misconfiguration. Exact environment aliases are
`PCM_ENVIRONMENT`, `PCM_AUTH_MODE`, `PCM_AUTH_ISSUER`, `PCM_AUTH_PROXY_SECRETS`,
`PCM_AUTH_ADMIN_GROUPS`, `PCM_AUTH_REVIEWER_GROUPS`, and `PCM_AUTH_EDITOR_GROUPS`; existing aliases such
as `APP_DATABASE_URL` remain unchanged. A non-throwing `AuthConfigurationStatus` records validity and
safe reason codes. `/health` always returns `200 {"status":"ok","app":"..."}` when the process is
live. `/health/ready` returns `200 {"status":"ready","checks":{"auth":{"status":"pass"}}}` or
`503 {"status":"not_ready","checks":{"auth":{"status":"fail","reason_code":"auth_not_configured"}}}`.
Invalid production auth also makes every protected request use the standard 503 AppError body without
revealing the specific secret/group problem.

## RALPLAN-DR

### Principles

1. Fail closed; backend authorization is authoritative.
2. Stable IdP subject, not mutable profile fields, is audit identity.
3. Tokens stay at the SSO edge behind a replaceable application adapter.
4. Roles have one deterministic source and explicit permissions.
5. Do not add a runtime dependency/local identity DB without demonstrated need.

### Drivers

1. Closed-intranet deployment with a corporate IdP but no tenant/vendor values in this repo.
2. Existing `AuthAdapter -> UserContext` and router-wide authentication boundary.
3. Deliver testable RBAC now without coupling PCM to an IdP SDK or browser token lifecycle.

### Options

- **Trusted OIDC gateway (chosen):** small vendor-neutral app boundary, no token exposure/dependency;
  requires strict ingress/header replacement/secret configuration.
- **Backend JWT/JWKS validation:** stronger direct token proof but adds crypto/HTTP/cache dependencies
  and leaves browser/session architecture unresolved.
- **SPA OIDC PKCE:** direct standards integration but adds client/token lifecycle and XSS/storage risk.
- **Local roles:** flexible override but creates a second role truth and identity admin lifecycle.

## Consequences

- A future JWT adapter can implement the same `AuthAdapter` without router changes.
- Exact session TTL and group names remain deployment policy.
- Production release requires a tenant conformance checklist: login, each role, revocation/session
  refresh, logout/expiry, direct-backend denial, header stripping and secret rotation.
