# GitHub App installation lifecycle

The GitHub App integration is disabled unless `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_WEBHOOK_SECRET`, and
`GITHUB_APP_ADMIN_ORIGIN` are configured. Installation access tokens are requested only when
discovering repositories, held in memory for that request, and never persisted or logged.
The app private key is read from the API process environment and is never written to the
database.

## GitHub App settings

Configure the GitHub App with:

- Installation target: any account needed by RDPS projects.
- Repository permissions: **Metadata: read-only**, **Contents: read-only**,
  **Pull requests: read-only**, and **Issues: read-only** for current reference ingestion.
- Subscribe to `installation`, `installation_repositories`, `push`, `pull_request`,
  `issues`, and `release` events.
- Setup URL: `https://<api-origin>/api/v1/integrations/github-app/callback`.
  RDPS redirects the browser to the configured project page after accepting the install.
- Webhook URL: `https://<api-origin>/api/v1/integrations/github-app/webhook`.
- Webhook secret: configure a dedicated random secret as `GITHUB_APP_WEBHOOK_SECRET`.

Set `GITHUB_APP_ADMIN_ORIGIN` to the exact admin origin included in `WEB_BASE_URL`;
the successful installation callback redirects to the project settings page. Supply
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, the PEM private key, and webhook secret through the deployment
secret manager or process environment. In local Docker development, leave them unset to
exercise the explicit disabled state, or provide a dedicated development App. Never commit
the private key into `.env.example`, the repository, or project documentation.

## Project workflow and security

Only a project admin or system admin can begin installation, discover repositories, link
repositories, or disconnect links. The install callback uses a cryptographically random,
10-minute state value; only its SHA-256 hash is stored, and the callback consumes it once.
The callback rechecks the initiating user's active status and project-admin role before
accepting the installation. The provider's API verifies the returned installation ID.

Webhook requests use GitHub's SHA-256 HMAC signature and delivery ID. Delivery IDs are
persisted uniquely before lifecycle changes, so retries cannot repeat the transition or
audit records. Installation suspend, resume, uninstall, and repository-access removal
update project connection state and remove only repository links owned by that installation.
Repository discovery is live; admins choose which repositories to link. Signed push,
pull-request, issue, and release events for repositories linked to that installation enter
the normal retryable reference-ingestion queue. Events for unlinked repositories are ignored.
A merged pull request, tag, or deployment never publishes a release automatically.
