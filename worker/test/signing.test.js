import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dispatchSigningWorkflow,
  parseSigningForm,
  taskErrorKey,
  taskResultKey,
} from "../src/signing.js";

const TASK_ID = "123e4567-e89b-12d3-a456-426614174000";
const ENV = {
  GITHUB_TOKEN: "github-token",
  GITHUB_OWNER: "ice-owner",
  GITHUB_REPO: "orvia-sign-test",
  GITHUB_WORKFLOW: "sign.yml",
  GITHUB_REF: "main",
};

function multipartRequest({ extra = false } = {}) {
  const form = new FormData();
  form.set("p12", new File(["p12-bytes"], "cert.p12"));
  form.set("mobileprovision", new File(["profile-bytes"], "profile.mobileprovision"));
  form.set("password", "test-password");
  if (extra) form.set("unexpected", "value");
  return new Request("https://beta.ice329.me/api/sign", {
    method: "POST",
    body: form,
  });
}

test("accepts multipart signing data without an access token", async () => {
  const result = await parseSigningForm(multipartRequest(), ENV);
  assert.equal(result.ok, true);
});

test("encodes p12 and profile and preserves password", async () => {
  const result = await parseSigningForm(multipartRequest(), ENV);
  assert.equal(result.ok, true);
  assert.equal(result.p12Base64, Buffer.from("p12-bytes").toString("base64"));
  assert.equal(result.profileBase64, Buffer.from("profile-bytes").toString("base64"));
  assert.equal(result.p12Password, "test-password");
});

test("rejects unsupported multipart fields", async () => {
  const result = await parseSigningForm(multipartRequest({ extra: true }), ENV);
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
});

test("dispatches the fixed workflow with the task id and exact inputs", async () => {
  const calls = [];
  const payload = {
    taskId: TASK_ID,
    p12Base64: "cDEy",
    profileBase64: "cHJvZmlsZQ==",
    p12Password: "test-password",
  };
  await dispatchSigningWorkflow(ENV, payload, async (...args) => {
    calls.push(args);
    return new Response(null, { status: 204 });
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][0],
    "https://api.github.com/repos/ice-owner/orvia-sign-test/actions/workflows/sign.yml/dispatches",
  );
  assert.equal(calls[0][1].headers.Authorization, "Bearer github-token");
  const body = JSON.parse(calls[0][1].body);
  assert.deepEqual(Object.keys(body.inputs).sort(), [
    "p12_base64",
    "p12_password",
    "profile_base64",
    "task_id",
  ]);
  assert.equal(body.inputs.task_id, TASK_ID);
  assert.equal(body.inputs.p12_password, "test-password");
});

test("accepts GitHub's successful workflow dispatch response", async () => {
  await assert.doesNotReject(
    dispatchSigningWorkflow(ENV, {
      taskId: TASK_ID,
      p12Base64: "cDEy",
      profileBase64: "cHJvZmlsZQ==",
      p12Password: "test-password",
    }, async () => new Response(JSON.stringify({ workflow_run_id: 1 }), { status: 200 })),
  );
});

test("turns non-204 GitHub dispatch into a generic error", async () => {
  await assert.rejects(
    dispatchSigningWorkflow(ENV, {
      taskId: TASK_ID,
      p12Base64: "cDEy",
      profileBase64: "cHJvZmlsZQ==",
      p12Password: "secret-password",
    }, async () => new Response("secret-password", { status: 500 })),
    (error) => error.message === "GitHub workflow dispatch failed",
  );
});

test("rejects malformed task ids and creates bounded result keys", () => {
  assert.throws(() => taskResultKey("not-a-uuid"));
  assert.throws(() => taskErrorKey(TASK_ID.toUpperCase()));
  assert.equal(taskResultKey(TASK_ID), `sign/${TASK_ID}/result.json`);
  assert.equal(taskErrorKey(TASK_ID), `sign/${TASK_ID}/error.json`);
});
