# Orvia OTA Phase 2 Operator Runbook

This runbook covers the Phase 2 handoff from local verification through separately
approved Cloudflare deployment, upload, HTTP checks, and iPhone acceptance. The
local checks are verification only. They do not upload to R2, deploy the Worker,
change DNS or a certificate, or install an app on an iPhone.

## Phase 2 contract

Keep these values exact throughout the handoff:

| Item | Required value |
| --- | --- |
| App Bundle ID | `com.ice.orvia` |
| R2 bucket | `orvia-beta` |
| Worker public host | `beta.ice329.me` |
| IPA object key | `sign/{taskId}/Orvia.ipa` |
| Manifest object key | `sign/{taskId}/manifest.plist` |
| IPA content type | `application/octet-stream` |
| Manifest content type | `application/xml` |

The publisher consumes an already signed `Orvia-signed.ipa` from the existing
signing workflow. It validates that the IPA contains the lowercase
`com.ice.orvia` Bundle ID before producing a publish plan. The Worker is a
read-only object-serving boundary: it accepts only `GET` and `HEAD` requests for
the two canonical task-scoped object paths and never performs browser upload,
signing, or R2 writes.

The recorded `taskId` is the recovery handle for the whole handoff. Use the same
ID for the dry-run, approved upload, HTTP verification, iPhone acceptance record,
and any partial-upload cleanup. Do not substitute a new ID after an upload
failure.

## Gate separation

Run the local gate first. It is safe to repeat and must finish before any live
Cloudflare action is considered. Deployment, custom-domain/DNS/certificate work,
and R2 upload are a separate operator gate requiring explicit approval and the
appropriate authenticated account.

## 1. Local-only verification

From the repository root, verify that Python 3.10 or newer, Node.js, npm, and npx
are available. Then run the Worker checks from `worker/`:

```powershell
Push-Location worker
npm test
npx --yes wrangler@4.125.0 deploy --dry-run
Pop-Location
```

Run the existing Phase 1 publisher suite and Python compilation check from the
repository root:

```powershell
python -B -m unittest discover -s tests -v
python -B -m py_compile tools/publish_ota.py tests/test_publish_ota.py
git diff --check
```

Expected local results are a passing Node test run, Wrangler validation/bundling
without deployment, `Ran 38 tests` followed by `OK` from the Python suite, no
output and exit code 0 from `py_compile`, and no output from `git diff --check`.
The local commands do not perform an R2 upload, Worker deployment, DNS change,
certificate mutation, or iPhone installation.

Environment note: if a bundled Node installation needs a serial test-runner
workaround, this equivalent diagnostic command can be used:

```powershell
Push-Location worker
node --test --test-concurrency=1 test/index.test.js
Pop-Location
```

This is only an environment workaround. It does not replace `npm test`, which is
the required package-script check.

## 2. Separately approved live preflight

Before deployment or upload, an operator must record approval for the live action
and confirm all of the following:

- Wrangler is authenticated to the intended Cloudflare account. A read-only
  identity check may be run from `worker/`:

  ```powershell
  Push-Location worker
  npx --yes wrangler@4.125.0 whoami
  Pop-Location
  ```

- The account already owns or controls the `ice329.me` zone.
- The exact Phase 2 R2 bucket is `orvia-beta`. Create it if it does not exist;
  do not select or substitute another bucket for this handoff.
- `beta.ice329.me` is available for the Worker custom domain and the operator has
  explicit approval for any Custom Domain, DNS, or certificate mutation needed to
  make it serve HTTPS.
- The signed input is `Orvia-signed.ipa` and its validated Bundle ID is
  `com.ice.orvia`.
- The 32-hex-character Cloudflare account ID needed by the approved publisher
  upload has been obtained through the operator's normal secret-safe process.

The only accepted public base URL for Phase 2 is
`https://beta.ice329.me`. Treat the legacy root host `ice329.me`,
`www.ice329.me`, `downloads.ice329.me`, and every other hostname as a hard stop;
do not pass any of them to the publisher. Treat any bucket other than
`orvia-beta` as a hard stop as well.

No local check above authorizes this live gate. If the account, zone, bucket,
custom-domain availability, certificate/DNS approval, or input Bundle ID cannot
be confirmed, stop before deployment and upload.

## 3. Approved Worker deployment

After the live preflight is approved, deploy the Worker from `worker/` with the
pinned Wrangler version:

```powershell
Push-Location worker
npx --yes wrangler@4.125.0 deploy
Pop-Location
```

This is a live Cloudflare action. It may deploy the Worker and apply the
configured custom-domain/DNS/certificate state for `beta.ice329.me`; it must not
be run as part of the local gate without the separate approval. Record the
deployment result, Worker version, account, host, and timestamp.

The deployed Worker remains read-only. It serves only the exact task-scoped keys
below through the `OTA_BUCKET` binding to `orvia-beta`:

```text
sign/{taskId}/Orvia.ipa
sign/{taskId}/manifest.plist
```

It does not expose an upload route and does not perform signing, browser upload,
or automatic credential/profile handling.

## 4. Approved task-scoped upload

First create a dry-run plan from the repository root. This validates the signed
IPA, generates the manifest, and prints the task-scoped URLs without uploading
either object:

```powershell
python tools/publish_ota.py --ipa Orvia.ipa --bucket orvia-beta --base-url https://beta.ice329.me --dry-run
```

Save the JSON output and record its `taskId`, `ipaKey`, `manifestKey`,
`ipaUrl`, `manifestUrl`, and `installUrl`. Confirm that the output contains
`bundleIdentifier` equal to `com.ice.orvia`, the exact keys
`sign/{taskId}/Orvia.ipa` and `sign/{taskId}/manifest.plist`, and HTTPS URLs on
`beta.ice329.me`. Stop if any value differs. The dry-run performs no R2 upload
and must be the source of the task ID used for every subsequent step.

Only after the dry-run output and the upload have separate human approval, run
the approved upload with the same recorded task ID and a 32-hex account ID:

```powershell
python tools/publish_ota.py --ipa Orvia.ipa --bucket orvia-beta --base-url https://beta.ice329.me --task-id <taskId-from-dry-run> --account-id <32-hex-account-id>
```

This command performs the two R2 object uploads. The publisher invokes the pinned
`orvia-beta` bucket and applies `application/octet-stream` to the IPA and
`application/xml` to the manifest. In environments without `npx`, use the
equivalent pinned `pnpm.cmd dlx wrangler@4.125.0` commands from the recorded
plan. Do not remove `--remote`, change the bucket, change the base URL, or rerun
with a newly generated task ID.

If the upload exits nonzero after starting, the first object may exist while the
manifest does not. Keep the dry-run task ID, inspect only that task prefix, and
either retry the approved upload with the same ID or perform the task-scoped
cleanup described below. Do not infer a new task ID from a later command's
output.

## 5. HTTP verification

HTTP verification is a separate live gate. After the approved upload and before
running either `curl.exe -I` command, record a separate approval for HTTP
verification with the recorded task ID, upload result, and exact URLs. Approval
for the R2 upload does not automatically authorize this stage. Only after that
approval is recorded, check both objects through the exact Phase 2 HTTPS host.
These commands issue `HEAD` requests, which the read-only Worker supports:

```powershell
curl.exe -I https://beta.ice329.me/sign/<taskId>/Orvia.ipa
curl.exe -I https://beta.ice329.me/sign/<taskId>/manifest.plist
```

For both responses, require HTTPS and a successful `200` status. Require these
content types exactly:

| URL path | Required `Content-Type` |
| --- | --- |
| `sign/{taskId}/Orvia.ipa` | `application/octet-stream` |
| `sign/{taskId}/manifest.plist` | `application/xml` |

Stop if either URL redirects unexpectedly, is not HTTPS, returns anything other
than `200`, is missing, or returns a different content type. Do not continue to
iPhone acceptance until both task-scoped objects pass these checks.

## 6. iPhone Safari acceptance

iPhone acceptance is a separate live gate. After HTTP verification has passed and
before opening Safari, record a separate approval for iPhone acceptance with the
recorded task ID and HTTP results. HTTP-verification approval or a passing HTTP
check does not automatically authorize this stage. Then use the `installUrl`
recorded from the approved publisher result:

1. On the target iPhone, open the `installUrl` in Safari.
2. Confirm that iOS presents the installation prompt for Orvia.
3. Complete the installation and confirm that the installed app launches.
4. Verify through the available device/package inspection that the installed
   app's Bundle ID is exactly `com.ice.orvia`; do not treat the display name alone
   as proof.
5. Record the task ID, device identifier, iOS version, deployment/upload
   timestamps, and the observed result.

This is a live acceptance step and is not performed by any local command. A
successful HTTP check alone is not an iPhone acceptance result.

## 7. Task-scoped cleanup after a partial upload

Cleanup is allowed only after an approved operator has confirmed the recorded
task ID and the reason for cleanup. Delete only these two possible objects under
the exact `orvia-beta` bucket and recorded task prefix:

```text
sign/{taskId}/Orvia.ipa
sign/{taskId}/manifest.plist
```

Do not delete another task prefix, the entire bucket, or any object outside this
handoff. If a retry is approved, reuse the same `--task-id` so that cleanup and
recovery remain bounded to the original task. No automatic lifecycle cleanup is
assumed for this phase.

## 8. Non-goals and safety boundaries

The following remain outside Phase 2 and require a later, separately approved
change:

- p12 or provisioning-profile handling;
- browser upload flows;
- automatic signing or credential management;
- lifecycle/retention cleanup;
- changes to the existing signing workflow, website, backend, or legacy
  Cloudflare resources;
- migration of the Bundle ID to `com.ice.Orvia`.

Never paste tokens, passwords, p12 contents, or profile contents into this
runbook or a command. The account ID is a non-secret routing value but must still
be checked as exactly 32 hexadecimal characters before the approved upload. Keep
local verification, live Cloudflare mutation, R2 upload, HTTP verification, and
iPhone acceptance as separate recorded gates; approval for one named stage does
not automatically authorize the next stage.
