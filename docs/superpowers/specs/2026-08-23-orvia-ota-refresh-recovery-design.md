# Orvia OTA Refresh Recovery Design

## Goal

Keep a completed Orvia signing task recoverable after the tester refreshes
`https://beta.ice329.me/`, without asking the tester to upload the p12 or
mobileprovision again.

## Root cause

The current page keeps the task ID only in JavaScript memory. A refresh returns
to the upload form and stops polling. Separately, the GitHub workflow uploads a
valid `result.json` without a `status` field, while the Worker currently accepts
only `status: "complete"`; therefore the existing completed task is reported as
`queued`.

## Design

The fix has three small parts:

1. `tools/publish_ota.py` includes `status: "complete"` in new result JSON.
2. `worker/src/index.js` accepts a result object as complete when its task ID
   and validated install URL match, while still rejecting malformed objects and
   explicit non-complete statuses. This backward compatibility recovers the
   already-published task.
3. `worker/src/site.js` stores only the latest task UUID in `localStorage`.
   On page load it restores that UUID, resumes status polling, and shows the
   install link when complete. Certificate bytes and the password are never
   stored. A failed or malformed task clears the saved UUID.

The page still accepts only the existing p12, mobileprovision, and password
fields. The zsign command, lowercase Bundle ID `com.ice.orvia`, GitHub
workflow inputs, R2 bucket, Worker name, and all non-Orvia Cloudflare
resources remain unchanged.

## Status contract

The Worker continues to return:

```json
{"taskId":"...","status":"queued"}
{"taskId":"...","status":"complete","installUrl":"itms-services://..."}
{"taskId":"...","status":"failed","message":"safe operator-facing error"}
```

The publisher's result object adds the explicit `status` field for new jobs.
The Worker accepts the old missing-status result only when all existing task
and install URL validation checks pass.

## Testing

- Add a publisher test proving result JSON includes `status: "complete"`.
- Add a Worker status test proving a validated result without `status` is
  treated as complete and an explicit non-complete status is not.
- Add a site source/behavior test proving the task UUID is saved, restored,
  and cleared on failed status.
- Run the complete Worker test suite and the existing Python test suite.
- Deploy only `orvia-ota-worker`, then verify the recovered task status and
  install URL over HTTPS before asking for a new upload.

## Non-goals

- No p12, mobileprovision, or password persistence.
- No changes to the signing command or IPA Bundle ID.
- No changes to `wzautotool`, `wz-auto-updates`, WeChatBill, DNS, or any other
  existing Cloudflare resource.
