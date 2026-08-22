# Orvia OTA Phase 2 Worker/R2 Design

## Goal

Add the smallest production-shaped distribution layer for the already validated
Phase 1 publisher: a read-only Cloudflare Worker on `beta.ice329.me` reads
task-scoped objects from the isolated `orvia-install` R2 bucket and returns them
with the exact OTA content types. The existing Zsign/Xcode signing chain,
`tools/publish_ota.py` upload behavior, and uppercase Bundle ID deferral remain
unchanged.

Phase 2 continues to use:

```text
com.ice.orvia
```

The later `com.ice.Orvia` switch is explicitly outside this phase.

## Approved scope

The MVP has two separate responsibilities:

1. The existing CLI performs the approved upload of an already signed IPA and
   its generated manifest to R2.
2. The Worker provides public read-only HTTPS access to those two objects for
   Safari and the `itms-services` installer.

There is no browser upload form, anonymous upload endpoint, p12/profile input,
automatic signing, database, task discovery API, or mutation endpoint in this
phase. Upload credentials remain on the operator's machine and are not passed
through the Worker.

## Architecture

```text
signed IPA
    |
    v
tools/publish_ota.py --base-url https://beta.ice329.me
    |
    +--> R2 bucket: orvia-install
         sign/{taskId}/Orvia.ipa
         sign/{taskId}/manifest.plist
                    |
                    v
         Custom Domain: beta.ice329.me
                    |
                    v
              read-only Worker
                    |
                    +--> GET/HEAD /sign/{taskId}/Orvia.ipa
                    +--> GET/HEAD /sign/{taskId}/manifest.plist
```

The current Phase 1 URL planner already allows a safe HTTPS subdomain such as
`beta.ice329.me` and creates the exact task-scoped keys. Phase 2 therefore adds
the Worker without altering the signing or object naming logic.

## Worker request contract

The Worker accepts only these canonical paths:

```text
/sign/{lowercase-canonical-uuid}/Orvia.ipa
/sign/{lowercase-canonical-uuid}/manifest.plist
```

The UUID must be the canonical lowercase form produced by `plan_publish()`.
Percent-encoded path aliases, extra path segments, query strings, and fragments
are rejected rather than normalized into another R2 key. The Worker uses the
literal matched path as the R2 key, so path traversal and key prefix escape are
not possible.

Allowed methods are `GET` and `HEAD`. Other methods return `405` with
`Allow: GET, HEAD`. A missing object returns `404`. Unexpected R2 failures return
`500` without exposing credentials or internal binding details.

For a found object, the Worker preserves R2 metadata where available and
enforces the Phase 1 contract:

| Path | Content-Type | Cache policy |
|---|---|---|
| `Orvia.ipa` | `application/octet-stream` | `public, max-age=31536000, immutable` |
| `manifest.plist` | `application/xml` | `public, max-age=31536000, immutable` |

The response also includes `Content-Length`, `ETag`, and `Last-Modified` when
the R2 object exposes those values. `HEAD` returns the same headers without a
body. CORS and upload headers are intentionally omitted because OTA installation
does not need cross-origin JavaScript access.

## Wrangler configuration

Create a focused Worker project under `worker/` with:

- `worker/src/index.js` — module Worker and path/response helpers;
- `worker/test/index.test.js` — Node built-in tests using a small in-memory R2
  binding double;
- `worker/wrangler.jsonc` — Worker name, current compatibility date, observability,
  the `OTA_BUCKET` binding to `orvia-install`, and the `beta.ice329.me` Custom
  Domain;
- `worker/package.json` — local test and pinned Wrangler command entry points.

The repository must ignore `worker/node_modules/`, Wrangler state and generated
Worker types. The config is the source of truth but does not contain account
tokens or other secrets. The first deployment still requires an authenticated
operator and an existing Cloudflare account with the `orvia-install` bucket.

Cloudflare's current guidance supports R2 bindings through `r2_buckets`, read
operations through `head()`/`get()`, and Custom Domains with
`custom_domain: true`:

- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/workers/wrangler/configuration/

## Testing and acceptance

Automated tests must cover:

- the two valid paths and their exact R2 keys;
- `GET` body and content type for IPA and manifest;
- `HEAD` metadata-only response;
- missing object `404`;
- malformed UUID, uppercase UUID, percent-encoded path, extra segment, and
  query-string rejection;
- `POST`/`PUT`/`DELETE` `405` responses;
- R2 errors becoming a generic `500` response;
- no request path allowing an object outside `sign/{taskId}/`.

Local verification must run the Worker tests, Wrangler dry-run/config validation,
and all existing Python tests. Live R2 upload, Worker deployment, DNS/certificate
provisioning, HTTP checks, and iPhone installation remain manual acceptance
steps and must be reported separately from local test results.

## Non-goals and safety boundaries

- Do not change `Orvia.ipa`, `.github/workflows/sign.yml`, Xcode settings, or the
  existing signing command chain.
- Do not change the publisher's enforced `com.ice.orvia` Bundle ID.
- Do not attach the Worker to `ice329.me`, `www.ice329.me`, or
  `downloads.ice329.me`.
- Do not create or delete Cloudflare resources during local implementation.
- Do not claim OTA installation success until a real signed IPA has been uploaded,
  both URLs return the expected headers, Safari installs it, the app launches,
  and the installed app's Bundle ID is verified.
