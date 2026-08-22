# Orvia Signing Toggle Design

## Goal

Give the Orvia operator a backend-only switch for accepting new signing
requests, without adding a new Cloudflare storage resource or changing OTA
downloads.

## Behavior

The existing `orvia-ota-worker` exposes a backend-only signing switch through
the existing `orvia-beta` R2 bucket. Missing configuration keeps signing
disabled; the admin page writes an explicit boolean state for the Orvia Worker.

When disabled, `POST /api/sign` returns HTTP 503 with a generic JSON error and
does not parse multipart data or dispatch GitHub. `GET /`, `/api/status/...`,
and existing `/sign/...` object routes remain available. When enabled, the
signing page accepts only p12, mobileprovision, and password fields and dispatches
the existing GitHub workflow.

## Operations

The operator toggles only this Orvia state from the existing Access-protected
admin page. The Worker uses the existing `orvia-beta` bucket for the bounded
configuration object; no KV, D1, new Worker, new R2 bucket, DNS, or other
Cloudflare resource is added. Existing OTA objects are not deleted or disabled
by the switch.

## Safety

The default is closed. Enabling signing deliberately permits public submission
from the signing page; the admin switch is the control for accepting new jobs.
The formal uppercase Bundle ID and all non-Orvia resources remain untouched.

## Verification

Tests cover disabled and enabled submission behavior, no GitHub dispatch while
disabled, the exact 503 JSON response, and the runbook commands for switching
the Orvia Worker value.
