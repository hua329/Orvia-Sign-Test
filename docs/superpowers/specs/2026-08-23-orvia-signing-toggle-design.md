# Orvia Signing Toggle Design

## Goal

Give the Orvia operator a backend-only switch for accepting new signing
requests, without adding a new Cloudflare storage resource or changing OTA
downloads.

## Behavior

`ORVIA_SIGNING_ENABLED` is read from the existing `orvia-ota-worker` Worker
environment. Only the exact case-insensitive string `true` enables new signing
requests. Missing, empty, or any other value disables them.

When disabled, `POST /api/sign` returns HTTP 503 with a generic JSON error and
does not parse multipart data or dispatch GitHub. `GET /`, `/api/status/...`,
and existing `/sign/...` object routes remain available. When enabled, the
existing access-token validation and GitHub workflow dispatch remain unchanged.

## Operations

The operator toggles only this Orvia Worker secret/configuration value through
Wrangler. No KV, D1, new Worker, new R2 bucket, DNS, or other Cloudflare
resource is added. Existing OTA objects are not deleted or disabled by the
switch.

## Safety

The default is closed. This toggle is not an identity system: enabling signing
does not make anonymous upload safe and does not remove the existing access
token requirement. The formal uppercase Bundle ID and all non-Orvia resources
remain untouched.

## Verification

Tests cover disabled and enabled submission behavior, no GitHub dispatch while
disabled, the exact 503 JSON response, and the runbook commands for switching
the Orvia Worker value.
