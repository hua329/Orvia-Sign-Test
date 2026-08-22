# Orvia Website + GitHub Actions OTA Signer Design

## Goal

Add an Orvia-only website at `https://beta.ice329.me/` where an authorized
tester submits a p12 certificate, matching mobileprovision, and p12 password.
The existing GitHub Actions + zsign chain signs the operator-controlled
lowercase unsigned IPA, publishes the signed IPA and OTA files to the Orvia R2
bucket, and returns an `itms-services` install URL.

The Phase 1 Bundle ID remains exactly `com.ice.orvia`. The existing formal
`Orvia.ipa` with `com.ice.Orvia` is not replaced or modified; the supplied
lowercase `Orvia-unsigned.ipa` becomes the Phase 1 signing input after review.

## Hard resource boundary

Only these Orvia resources may be changed:

- Worker: `orvia-ota-worker`
- R2 bucket: `orvia-beta`
- Host: `beta.ice329.me`
- This repository's Orvia GitHub Actions workflow and supporting code

The implementation must not read, update, delete, redeploy, or add bindings to
`wzautotool`, `wz-auto-updates`, or any other existing Cloudflare resource.
There is no cleanup operation that deletes an entire bucket or Worker.

## Architecture

The existing read-only Worker is extended with three bounded responsibilities:

1. `GET /` serves a small Orvia signing page.
2. `POST /api/sign` validates the access token and multipart p12/profile/password
   fields, creates a lowercase UUID task ID, and calls the GitHub Actions API
   to dispatch the existing signing workflow.
3. `GET /api/status/{taskId}` reads a task result or task error object from
   `orvia-beta` and returns a small JSON status response.

The existing OTA routes remain exact and task-scoped:

```text
GET|HEAD /sign/{taskId}/Orvia.ipa
GET|HEAD /sign/{taskId}/manifest.plist
GET|HEAD /sign/{taskId}/icon.png
```

The website never writes p12, mobileprovision, or password data to R2. The
Worker forwards them only to the GitHub workflow dispatch request. GitHub
repository and workflow access must be restricted to the operator's private
repository; workflow logs and job summaries must never print credentials.
Because GitHub workflow inputs can be retained in workflow event metadata, this
MVP is for a private, trusted-tester repository. A future one-time pull-token
transport can remove credential bytes from the dispatch payload, but it is not
part of this implementation.

## Data flow

```text
Tester browser
  | HTTPS + access token + p12/profile/password
  v
orvia-ota-worker /api/sign
  | GitHub API workflow_dispatch + task ID
  v
GitHub Actions (existing zsign chain)
  | zsign -k cert.p12 -p password -m profile.mobileprovision
  | -b com.ice.orvia
  | upload signed IPA, manifest, icon, result.json
  v
R2 orvia-beta
  ^
  | /api/status/{taskId} and /sign/{taskId}/...
  |
Tester browser -> itms-services install URL -> iPhone
```

The unsigned IPA is operator-controlled in the repository as
`Orvia-unsigned.ipa`; testers do not upload a different application in this
MVP. The Action verifies the IPA Bundle ID after signing before any public OTA
object is accepted.

## GitHub workflow changes

Keep the existing zsign invocation and input names. Add only the OTA handoff:

- check out `Orvia-unsigned.ipa` as the signing input;
- accept a Worker-supplied task ID;
- sign with the unchanged lowercase `-b com.ice.orvia` argument;
- run `tools/publish_ota.py` with `--bucket orvia-beta` and
  `--base-url https://beta.ice329.me`;
- extract one existing app icon as `icon.png` and upload it under the same
  task prefix with `image/png`;
- upload a result JSON containing task ID, Bundle ID, URLs, and install URL;
- publish the install URL in the workflow summary without any certificate,
  password, or profile contents;
- remove p12, mobileprovision, signed IPA, manifest, icon, and temporary files
  in an `always` cleanup step.

The workflow uses repository secrets for the Cloudflare API token and account
ID. They are not website fields and are never returned to the browser.

## Website API contract

`POST /api/sign` requires the Orvia access token and multipart fields:

```text
p12                 required file
mobileprovision     required file
password            required text
```

The response is:

```json
{"taskId":"<lowercase-uuid>","status":"queued"}
```

`GET /api/status/{taskId}` returns one of:

```json
{"taskId":"...","status":"queued"}
{"taskId":"...","status":"complete","installUrl":"itms-services://..."}
{"taskId":"...","status":"failed","message":"safe operator-facing error"}
```

The browser polls status and shows the install button only for `complete`.
Passwords and certificate bytes are never echoed in JSON, logs, HTML, R2, or
the workflow summary. Requests without the access token, with malformed UUIDs,
or with unsupported fields are rejected before GitHub dispatch.

## Security and failure handling

- The signing page is not anonymous: a Worker secret-backed access token is
  required. The GitHub token is a separate Worker secret and is never exposed
  to the browser.
- The GitHub repository must remain private and workflow access restricted,
  because the MVP dispatches credential bytes as workflow inputs even though
  they are omitted from logs and summaries.
- p12/profile/password are held only for the request and the GitHub dispatch;
  the Action deletes all temporary files in `if: always()` cleanup.
- The Worker enforces bounded file sizes and rejects missing or empty fields.
- The Worker is not an upload origin for R2. Its only R2 writes happen from the
  GitHub workflow through the existing pinned Wrangler publisher.
- A failed workflow writes only a safe task error object where possible; no
  secret material is included. Partial public objects remain task-scoped and
  can be removed by an operator using the recorded task ID.
- No other Cloudflare account resource is inspected or mutated by the website.

## Verification

Local tests will cover:

- exact `/sign` file routing and GET/HEAD behavior;
- access-token, multipart, size, and Bundle ID boundary validation;
- GitHub dispatch payload shape and absence of password logging;
- status polling for queued, complete, failed, malformed, and missing tasks;
- workflow static checks for the unchanged zsign arguments and cleanup block;
- existing Phase 1 publisher tests and the Worker contract suite.

Live acceptance will use the provided lowercase unsigned IPA and a real test
p12/profile/password, then verify R2 objects, manifest content, IPA download,
and iPhone Safari installation. No uppercase Bundle ID migration is part of
this work.

## Non-goals

- no p12/profile/password storage in R2;
- no anonymous public upload;
- no changes to the validated zsign command or signing chain;
- no changes to `wzautotool` or any non-Orvia Cloudflare resource;
- no Phase 3 Bundle ID switch to `com.ice.Orvia`;
- no general customer accounts, billing, or multi-tenant signing queue.
