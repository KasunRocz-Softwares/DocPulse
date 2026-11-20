# Optional OIDC single sign-on

RDPS supports OpenID Connect authorization-code sign-in with PKCE through `openid-client` 6.8.9. Password login remains enabled. SSO is unavailable until all required server-side settings are configured.

## Provider registration

Register RDPS as a confidential OIDC client and register this redirect URI at the provider, replacing the example API origin with the configured `RDPS_API_PUBLIC_ORIGIN`:

```text
https://api.example.com/api/v1/internal/auth/oidc/callback
```

The issuer value must be the provider's exact issuer identifier from its discovery metadata. RDPS uses discovery at `<issuer>/.well-known/openid-configuration`; discovery and token/JWKS endpoints must use HTTPS, except loopback URLs for local development. The provider must return an ID token containing `sub`, `email`, `email_verified: true`, `iss`, `aud`, `exp`, and the request nonce. RDPS requests `openid email profile` and authenticates the token exchange with `client_secret_basic`.

## Required environment variables

| Variable                 | Meaning                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `OIDC_ISSUER`            | Exact issuer identifier URL from provider metadata.                                                                           |
| `OIDC_CLIENT_ID`         | Confidential client identifier.                                                                                               |
| `OIDC_CLIENT_SECRET`     | Confidential client secret. Store it in the deployment secret store.                                                          |
| `OIDC_CALLBACK_URL`      | Exact public callback URL: `https://<api-host>/api/v1/internal/auth/oidc/callback`.                                           |
| `OIDC_STATE_SECRET`      | Independent random secret of at least 32 bytes used to authenticate the browser-bound OIDC transaction cookie.                |
| `RDPS_API_PUBLIC_ORIGIN` | API origin only, such as `https://api.example.com`; no path, query, or trailing endpoint path.                                |
| `RDPS_OIDC_ADMIN_ORIGIN` | Admin web origin only, such as `https://app.example.com`. It must exactly match one origin in `WEB_BASE_URL`.                 |
| `WEB_BASE_URL`           | Comma-separated allowed web origins used by CORS; include the admin origin.                                                   |
| `OIDC_AUTO_PROVISION`    | Optional; only the exact value `true` enables account provisioning. Missing or any other value disables it. Default: `false`. |

Generate a dedicated state key, for example with `openssl rand -base64 48`. Do not reuse the JWT signing secret or OIDC client secret. In local development use matching loopback origins, for example API `http://localhost:13001`, admin `http://localhost:5173`, and callback `http://localhost:13001/api/v1/internal/auth/oidc/callback`. Production origins and provider endpoints must use HTTPS.

## Account and session behavior

RDPS finds an SSO identity only by the configured issuer and provider `sub`, represented by a SHA-256 digest of the issuer/subject pair under provider `oidc`. A matching email address alone never links identities. Users with an existing RDPS account can explicitly link it while signed in by rendering `<OidcLogin mode="link" />`; the signed-in user ID is bound into the transaction and the provider's verified email must match the RDPS account email. The link is audited. When no identity and no matching RDPS email exist, account provisioning follows the policy below.

With `OIDC_AUTO_PROVISION=false`, unknown identities are refused. When explicitly enabled, a verified identity creates an active RDPS user with no password and no project memberships. The user receives no project access until a project administrator grants membership. Existing suspended users remain unable to sign in. System-admin privileges and project roles are never copied from OIDC claims.

Successful OIDC login creates the same RDPS refresh session and short-lived bearer access token used by password login. The API sets refresh and transaction cookies as HttpOnly; production cookies use Secure. The browser-bound transaction cookie is SameSite=Lax, signed with `OIDC_STATE_SECRET`, and expires after five minutes. It contains independently random state, nonce, and PKCE verifier material. State is compared in constant time; the OIDC library checks state, nonce, PKCE, issuer, audience, expiration, and ID-token signature against discovered JWKS before RDPS considers identity claims.

The callback URL is fixed from configuration, and the post-login return target is a configured admin origin validated against `WEB_BASE_URL`. The API does not accept a request-supplied callback or return URL. On success it returns with the fixed `oidc=success` marker; the admin component exchanges the callback-created HttpOnly refresh cookie for the normal access token after returning to the application.

Because the existing RDPS refresh cookie is `SameSite=Strict`, deploy the admin and API on the same schemeful site (for example, `app.example.com` and `api.example.com`) so the browser includes the cookie in the credentialed refresh request. Configure the admin origin in API CORS via `WEB_BASE_URL`.

## API and admin component

- `GET /api/v1/internal/auth/oidc/config` returns `{ "enabled": boolean }` and never exposes provider secrets.
- `GET /api/v1/internal/auth/oidc/start` begins discovery-backed authorization and redirects to the provider.
- `POST /api/v1/internal/auth/oidc/link/start` requires a bearer-authenticated RDPS session and starts the explicit account-link flow.
- `GET /api/v1/internal/auth/oidc/callback` validates the transaction, verifies the ID token, creates/loads the RDPS identity, and returns to the configured admin origin.
- `apps/admin-web/src/OidcLogin.tsx` discovers whether SSO is configured and handles the one-time post-callback session refresh for login. RDPS mounts it in the password sign-in view and the authenticated account security view; it renders no control when SSO is disabled.

## Failure behavior

Missing configuration disables the SSO button and makes start fail closed. Cancelled provider authorization, missing code/state, mismatched or expired state, altered transaction cookies, PKCE failure, nonce mismatch, RFC 9207 authorization response issuer mismatch, invalid ID-token issuer/audience/authorized party, expired or invalidly signed ID tokens, missing/unverified email, inactive identities, unlinked existing emails, and disabled provisioning do not create an RDPS session. Callback failures return only a generic `oidc_error=authentication_failed` marker to the validated admin origin; provider error text, codes, tokens, and claims are not reflected into the browser URL.

Local password, invitation acceptance, refresh, logout, and session revocation routes are unchanged.
