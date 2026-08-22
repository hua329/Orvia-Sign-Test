# Orvia OTA Phase 1 Runbook

This runbook documents the non-destructive Phase 1 OTA handoff. It is limited to
the new Orvia installation path and does not change the existing signing workflow,
website, download service, or Cloudflare resources.

## Phase 1 input contract

Phase 1 consumes an already signed `Orvia-signed.ipa`. Its bundle identifier must
be the lowercase `com.ice.orvia`.

The tracked unsigned `Orvia.ipa` may still contain the deferred uppercase bundle
identifier `com.ice.Orvia`; it must not be used as the Phase 1 publish input. The
uppercase `com.ice.Orvia` path waits for a successful OTA before it is considered.

## Preflight and scope

Before any upload is considered, a human operator must confirm all of the
following:

- A separate R2 bucket named `orvia-install` exists for this handoff.
- A separate download hostname, such as `orvia-install.ice329.me`, is configured
  for that bucket and serves HTTPS.
- The bucket and hostname are isolated from the existing installation path.

Keep the following explicitly out of scope: `ice329.me`, `www.ice329.me`,
`downloads.ice329.me`, old Workers, old D1, and old R2. Do not point the Phase 1
publisher at any of them.

This runbook does not create or deploy Cloudflare resources. This task does not
execute an R2 upload or any other Cloudflare resource mutation; the upload command
below is documented for a separately approved and configured operator action.

## Dry run

Run the publisher with `--dry-run` first. It validates the IPA and prints the
task-scoped result, including the `taskId` and generated `installUrl`, without
performing either R2 object upload. Capture and record the `taskId` from this
dry-run before proceeding; retain the same value for the approved upload, HTTP
verification, and any cleanup or recovery.

```powershell
python tools/publish_ota.py --ipa Orvia-signed.ipa --bucket orvia-install --base-url https://orvia-install.ice329.me --dry-run
```

Stop if validation does not report the lowercase `com.ice.orvia` bundle
identifier, or if the bucket/base URL is not the separate Phase 1 path.

## Approved upload

Only after the preflight configuration and dry-run output have received prior
human approval, and after recording the dry-run `taskId`, run the command without
`--dry-run` and pass that same ID explicitly:

```powershell
python tools/publish_ota.py --ipa Orvia-signed.ipa --bucket orvia-install --base-url https://orvia-install.ice329.me --task-id <taskId-from-dry-run>
```

The approved upload path invokes the two argument-list commands with the pinned
`wrangler@4` package and `--remote` on each `r2 object put`. Wrangler v4 defaults
commands that can use local or remote storage to local, so `--remote` is required
to target the account's R2 bucket. Do not remove `--remote` or substitute an
unpinned Wrangler package for an approved upload.

Warning: this command performs the two R2 object uploads. It requires prior human
approval and configuration, and it must not be run against an existing ice329
bucket, hostname, Worker, D1 database, or R2 path. The explicit `--task-id`
keeps both uploads under the task ID already recorded from the dry-run. The CLI
prints its final result only after both uploads succeed; if the second upload
fails, the failed command may not print a task ID, so use the recorded dry-run ID
for recovery, retry, or cleanup. Do not rerun with a new task ID.

The publisher returns a `taskId`, URLs, and the OTA `installUrl`. The object keys
must be exactly these task-scoped paths:

```text
sign/{taskId}/Orvia.ipa
sign/{taskId}/manifest.plist
```

The IPA upload must use `application/octet-stream`, and the manifest upload must
use `application/xml`.

If the upload exits nonzero after starting, a partial upload may leave
`sign/{taskId}/Orvia.ipa` without `sign/{taskId}/manifest.plist`. Use the recorded
dry-run ID to check the two task-scoped objects. After resolving the cause, retry
the approved command with the same `--task-id <taskId-from-dry-run>`, or clean up
only that task's objects.

## HTTP verification

After an approved upload, check both objects through the separate HTTPS hostname:

```powershell
curl.exe -I https://orvia-install.ice329.me/sign/<taskId>/Orvia.ipa
curl.exe -I https://orvia-install.ice329.me/sign/<taskId>/manifest.plist
```

Before attempting OTA, require successful HTTP responses over HTTPS and confirm
these content types exactly:

- `sign/<taskId>/Orvia.ipa` returns `Content-Type: application/octet-stream`.
- `sign/<taskId>/manifest.plist` returns `Content-Type: application/xml`.

If either object is missing, served over a non-HTTPS URL, or has a different
content type, stop and resolve the isolated Phase 1 configuration before using
the installation URL.

## iPhone Safari acceptance

1. On an iPhone, open the generated `installUrl` in Safari.
2. Confirm that iOS presents the installation prompt for Orvia.
3. Confirm that the installed app launches successfully.
4. Run the existing website and backend regression checks and confirm they still
   pass. These checks are verification only; do not alter the existing website or
   backend as part of this handoff.

## Cleanup

Record the `taskId` from the dry-run before any upload and retain it through
verification. Do not rely on the upload command's final output to recover it: if
the second upload fails, the command may terminate before printing the result.
Use the saved dry-run ID if cleanup is needed, and delete only that task's two
objects in the separate `orvia-install` bucket:

```text
sign/{taskId}/Orvia.ipa
sign/{taskId}/manifest.plist
```

Do not remove other task prefixes or touch the existing ice329 resources. A
24-hour automatic lifecycle cleanup belongs to Phase 4 and is not assumed for
Phase 1.

## Secret safety and Phase 1 boundaries

The Phase 1 publisher has no P12/profile/password/GitHub token fields and does not
persist them. Never paste secrets into commands or this runbook; no secret values
or credential-bearing command belongs here.

Phase 1 uses lowercase `com.ice.orvia`. The uppercase `com.ice.Orvia` path waits
for successful OTA. Do not alter the existing signing workflow, IPA, website, old
download domain, old Worker, old D1, or old R2. No Cloudflare resource mutation or
deployment is performed by this task.
