# Orvia OTA Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Add a local-only, repeatable publisher that reads a signed IPA, generates an OTA manifest for `com.ice.orvia`, and prepares isolated R2 upload commands without changing the existing Zsign workflow.

**Architecture:** Keep the repository as a static IPA plus existing workflow. Add one standard-library Python module with pure metadata/manifest/planning functions and a CLI wrapper around Wrangler R2 object uploads. Use one UUID task path per publish and reject unsafe public domains before any upload command is run.

**Tech Stack:** Python 3 standard library (`zipfile`, `plistlib`, `urllib.parse`, `subprocess`, `unittest`), Wrangler CLI for R2 object uploads, Apple XML plist.

## Global Constraints

- Phase 1 uses lowercase `com.ice.orvia` everywhere; only after OTA succeeds on a real device may a separate change move to `com.ice.Orvia`.
- Do not modify `.github/workflows/sign.yml`, Zsign flags, `Orvia.ipa`, or the existing GitHub Artifact behavior.
- Do not accept, read, persist, or upload P12, mobileprovision, passwords, GitHub tokens, or other signing secrets.
- Use a new `orvia-install` R2 bucket and a separate download host; never use `downloads.ice329.me`, `ice329.me`, or `www.ice329.me`.
- Every object key must be under `sign/{taskId}/`; do not publish a shared root `Orvia.ipa`.
- Tests must not connect to Cloudflare or execute Wrangler.
- Before claiming completion, run the focused tests, the full test suite, dry-run output verification, and repository status checks.

## File Map

- Create: `tools/__init__.py` — make the tools directory importable by the test runner.
- Create: `tools/publish_ota.py` — IPA inspection, manifest serialization, safe publish planning, Wrangler command construction, and CLI.
- Create: `tests/__init__.py` — make the test package importable on Windows and in `unittest` discovery.
- Create: `tests/test_publish_ota.py` — generated IPA fixtures and behavior tests for metadata, manifest, URL safety, task isolation, and dry-run planning.
- Create: `docs/operations/orvia-ota-phase1-runbook.md` — preflight, non-destructive dry-run, R2 upload procedure, HTTP checks, and iPhone Safari acceptance steps.
- Modify: none of the existing workflow or IPA files.

---

### Task 1: Add failing IPA metadata tests

**Files:**
- Create: `tools/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/test_publish_ota.py`

**Interfaces:**
- Tests will import `inspect_ipa`, `IpaMetadata`, and `PublishError` from `tools.publish_ota`.
- The fixture helper will create a minimal ZIP with `Payload/Orvia.app/Info.plist`; it will never read or create signing files.

- [ ] **Step 1: Write the failing tests**

```python
def test_inspect_ipa_reads_bundle_and_versions(self):
    ipa = make_ipa(self.tempdir, {
        "CFBundleIdentifier": "com.ice.orvia",
        "CFBundleVersion": "42",
        "CFBundleShortVersionString": "1.4.2",
    })

    metadata = inspect_ipa(ipa)

    self.assertEqual(metadata.bundle_identifier, "com.ice.orvia")
    self.assertEqual(metadata.bundle_version, "42")
    self.assertEqual(metadata.bundle_short_version, "1.4.2")

def test_inspect_ipa_rejects_wrong_bundle_id(self):
    ipa = make_ipa(self.tempdir, {
        "CFBundleIdentifier": "com.ice.Orvia",
        "CFBundleVersion": "42",
    })

    with self.assertRaisesRegex(PublishError, "com.ice.orvia"):
        inspect_ipa(ipa)

def test_inspect_ipa_rejects_missing_info_plist(self):
    ipa = make_ipa(self.tempdir, None)

    with self.assertRaisesRegex(PublishError, "Info.plist"):
        inspect_ipa(ipa)
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run:

```powershell
python -m unittest tests.test_publish_ota -v
```

Expected: FAIL during import because `tools.publish_ota` does not exist yet. Do not add production code before observing this failure.

- [ ] **Step 3: Commit the red tests**

```powershell
git add tools/__init__.py tests/__init__.py tests/test_publish_ota.py
git -c user.name="Codex" -c user.email="codex@local" commit -m "test: define OTA IPA inspection contract"
```

### Task 2: Implement IPA inspection and turn the tests green

**Files:**
- Create: `tools/publish_ota.py`
- Test: `tests/test_publish_ota.py`

**Interfaces:**
- `EXPECTED_BUNDLE_ID: str = "com.ice.orvia"`
- `class PublishError(Exception)` for short, user-facing validation failures.
- `@dataclass(frozen=True) class IpaMetadata` with `bundle_identifier: str`, `bundle_version: str`, `bundle_short_version: str | None`, and `info_plist_path: str`.
- `def inspect_ipa(path: Path) -> IpaMetadata`.

- [ ] **Step 1: Implement only the minimum inspection behavior**

```python
def inspect_ipa(path: Path) -> IpaMetadata:
    if not path.is_file() or path.suffix.lower() != ".ipa":
        raise PublishError("IPA 文件无效")
    try:
        with ZipFile(path) as archive:
            candidates = [
                name for name in archive.namelist()
                if name.startswith("Payload/") and name.endswith(".app/Info.plist")
            ]
            if len(candidates) != 1:
                raise PublishError("无法读取 App 的 Info.plist")
            info = plistlib.loads(archive.read(candidates[0]))
    except (BadZipFile, KeyError, plistlib.InvalidFileException, OSError) as exc:
        raise PublishError("IPA 文件无效") from exc
    bundle_id = info.get("CFBundleIdentifier")
    if bundle_id != EXPECTED_BUNDLE_ID:
        raise PublishError("Bundle ID 必须为 com.ice.orvia")
    raw_version = info.get("CFBundleVersion") or info.get("CFBundleShortVersionString")
    if not isinstance(raw_version, str) or not raw_version.strip():
        raise PublishError("无法读取 App 版本")
    short_version = info.get("CFBundleShortVersionString")
    return IpaMetadata(bundle_id, raw_version, short_version, candidates[0])
```

The implementation must validate string types before returning metadata and keep the expected lowercase Bundle ID as the only accepted value.

- [ ] **Step 2: Run the focused tests to verify they pass**

Run:

```powershell
python -m unittest tests.test_publish_ota -v
```

Expected: all metadata tests PASS.

- [ ] **Step 3: Commit the green inspection implementation**

```powershell
git add tools/publish_ota.py tests/test_publish_ota.py
git -c user.name="Codex" -c user.email="codex@local" commit -m "feat: inspect signed IPA metadata"
```

### Task 3: Add failing manifest and URL-planning tests

**Files:**
- Modify: `tests/test_publish_ota.py`

**Interfaces:**
- Tests will import `build_manifest`, `plan_publish`, and `PublishPlan`.
- `plan_publish(metadata, bucket: str, base_url: str, task_id: str | None = None) -> PublishPlan` returns the complete task-scoped URLs and object keys.

- [ ] **Step 1: Add tests for manifest fields and XML escaping**

```python
def test_build_manifest_contains_ota_metadata(self):
    metadata = IpaMetadata("com.ice.orvia", "42", "1.4.2", "Payload/Orvia.app/Info.plist")

    manifest = plistlib.loads(build_manifest(metadata, "https://orvia-install.ice329.me/sign/t/Orvia.ipa"))

    item = manifest["items"][0]
    self.assertEqual(item["assets"][0]["kind"], "software-package")
    self.assertEqual(item["assets"][0]["url"], "https://orvia-install.ice329.me/sign/t/Orvia.ipa")
    self.assertEqual(item["metadata"]["bundle-identifier"], "com.ice.orvia")
    self.assertEqual(item["metadata"]["bundle-version"], "42")
    self.assertEqual(item["metadata"]["title"], "Orvia")

def test_build_manifest_escapes_xml_url_values(self):
    metadata = IpaMetadata("com.ice.orvia", "42", None, "Payload/Orvia.app/Info.plist")

    xml = build_manifest(metadata, "https://orvia-install.ice329.me/sign/t/Orvia.ipa?x=1&y=2")

    self.assertIn(b"&amp;", xml)
    self.assertEqual(
        plistlib.loads(xml)["items"][0]["assets"][0]["url"],
        "https://orvia-install.ice329.me/sign/t/Orvia.ipa?x=1&y=2",
    )

def test_plan_publish_isolates_task_and_builds_install_url(self):
    metadata = IpaMetadata("com.ice.orvia", "42", "1.4.2", "Payload/Orvia.app/Info.plist")

    plan = plan_publish(metadata, "orvia-install", "https://orvia-install.ice329.me", "00000000-0000-4000-8000-000000000001")

    self.assertEqual(plan.ipa_key, "sign/00000000-0000-4000-8000-000000000001/Orvia.ipa")
    self.assertIn("manifest.plist", plan.manifest_url)
    self.assertTrue(plan.install_url.startswith("itms-services://?action=download-manifest&url="))
    self.assertIn("https%3A%2F%2Forvia-install.ice329.me", plan.install_url)
```

- [ ] **Step 2: Add tests for unsafe base URLs and invalid task IDs**

```python
def test_plan_publish_rejects_existing_ice329_download_domains(self):
    metadata = IpaMetadata("com.ice.orvia", "42", None, "Payload/Orvia.app/Info.plist")

    for base_url in (
        "http://orvia-install.ice329.me",
        "https://downloads.ice329.me",
        "https://ice329.me",
        "https://www.ice329.me",
    ):
        with self.subTest(base_url=base_url):
            with self.assertRaises(PublishError):
                plan_publish(metadata, "orvia-install", base_url)
```

- [ ] **Step 3: Run the focused tests to verify the new tests fail**

Run:

```powershell
python -m unittest tests.test_publish_ota -v
```

Expected: the new tests FAIL because manifest serialization and publish planning are not implemented.

- [ ] **Step 4: Commit the red manifest/planning tests**

```powershell
git add tests/test_publish_ota.py
git -c user.name="Codex" -c user.email="codex@local" commit -m "test: define OTA manifest and task planning"
```

### Task 4: Implement manifest serialization and safe task planning

**Files:**
- Modify: `tools/publish_ota.py`
- Test: `tests/test_publish_ota.py`

**Interfaces:**
- `@dataclass(frozen=True) class PublishPlan` with `task_id`, `bucket`, `bundle_identifier`, `bundle_version`, `bundle_short_version`, `ipa_key`, `manifest_key`, `ipa_url`, `manifest_url`, `install_url`, `ipa_content_type`, and `manifest_content_type`.
- `def build_manifest(metadata: IpaMetadata, ipa_url: str) -> bytes` returns Apple XML plist bytes.
- `def plan_publish(metadata: IpaMetadata, bucket: str, base_url: str, task_id: str | None = None) -> PublishPlan`.

- [ ] **Step 1: Implement `build_manifest` with `plistlib`**

```python
payload = {
    "items": [{
        "assets": [{"kind": "software-package", "url": ipa_url}],
        "metadata": {
            "bundle-identifier": metadata.bundle_identifier,
            "bundle-version": metadata.bundle_version,
            "kind": "software",
            "title": "Orvia",
        },
    }]
}
return plistlib.dumps(payload, fmt=plistlib.FMT_XML, sort_keys=False)
```

- [ ] **Step 2: Implement `plan_publish` validation and URL construction**

Use `urllib.parse.urlparse`, `uuid.UUID`, and `urllib.parse.quote`. Require HTTPS, no query/fragment, a non-empty bucket, and a UUID task ID when supplied. Strip one trailing slash from the base URL. Reject the three existing ice329 hostnames and `downloads.ice329.me`. Set `ipa_content_type` to `application/octet-stream` and `manifest_content_type` to `application/xml`.

- [ ] **Step 3: Run focused tests to verify they pass**

Run:

```powershell
python -m unittest tests.test_publish_ota -v
```

Expected: all inspection, manifest, and planning tests PASS.

- [ ] **Step 4: Commit the green manifest/planning implementation**

```powershell
git add tools/publish_ota.py tests/test_publish_ota.py
git -c user.name="Codex" -c user.email="codex@local" commit -m "feat: generate isolated OTA manifest plans"
```

### Task 5: Add failing upload-command and CLI tests

**Files:**
- Modify: `tests/test_publish_ota.py`

**Interfaces:**
- Tests will import `build_upload_commands` and `serialize_result`.
- `build_upload_commands(plan: PublishPlan, ipa_path: Path, manifest_path: Path) -> list[list[str]]` returns two argument lists and never includes credentials.
- `serialize_result(plan: PublishPlan) -> str` returns stable JSON containing only the output-contract fields.

- [ ] **Step 1: Add pure command-construction tests**

```python
def test_upload_commands_set_content_types_and_task_keys(self):
    plan = plan_publish(metadata, "orvia-install", "https://orvia-install.ice329.me", FIXED_TASK_ID)
    commands = build_upload_commands(plan, Path("signed.ipa"), Path("manifest.plist"))

    self.assertEqual(len(commands), 2)
    self.assertIn("orvia-install/" + plan.ipa_key, " ".join(commands[0]))
    self.assertIn("--content-type=application/octet-stream", commands[0])
    self.assertIn("--content-type=application/xml", commands[1])
    joined = " ".join(" ".join(command) for command in commands)
    for forbidden in ("p12", "mobileprovision", "password", "token"):
        self.assertNotIn(forbidden, joined.lower())
```

- [ ] **Step 2: Add CLI dry-run test**

```python
def test_cli_dry_run_outputs_json_without_running_wrangler(self):
    completed = subprocess.run([
        sys.executable, "tools/publish_ota.py",
        "--ipa", str(ipa),
        "--bucket", "orvia-install",
        "--base-url", "https://orvia-install.ice329.me",
        "--task-id", FIXED_TASK_ID,
        "--dry-run",
    ], check=True, capture_output=True, text=True)

    output = json.loads(completed.stdout)
    self.assertEqual(output["bundleIdentifier"], "com.ice.orvia")
    self.assertTrue(output["installUrl"].startswith("itms-services://"))
```

- [ ] **Step 3: Run the focused tests to verify the new tests fail**

Run:

```powershell
python -m unittest tests.test_publish_ota -v
```

Expected: FAIL because command construction, result serialization, and the CLI entry point are not implemented.

- [ ] **Step 4: Commit the red CLI tests**

```powershell
git add tests/test_publish_ota.py
git -c user.name="Codex" -c user.email="codex@local" commit -m "test: define OTA dry-run and upload command contract"
```

### Task 6: Implement Wrangler upload planning and CLI dry-run

**Files:**
- Modify: `tools/publish_ota.py`
- Test: `tests/test_publish_ota.py`

**Interfaces:**
- `def build_upload_commands(plan: PublishPlan, ipa_path: Path, manifest_path: Path) -> list[list[str]]`.
- `def serialize_result(plan: PublishPlan) -> str`.
- `def main(argv: Sequence[str] | None = None) -> int`.

- [ ] **Step 1: Implement command construction without shell strings**

Return exactly these two command shapes, using argument lists rather than shell interpolation:

```text
npx wrangler@4 r2 object put {bucket}/{ipa_key} --remote --file={ipa_path} --content-type=application/octet-stream
npx wrangler@4 r2 object put {bucket}/{manifest_key} --remote --file={manifest_path} --content-type=application/xml
```

Use the `wrangler@4` package argument and `--remote` for both R2 object uploads because Wrangler v4 defaults commands that support local/remote storage to local. Use `str(Path)` for file arguments. No secret or user-provided command fragment may be passed through a shell.

- [ ] **Step 2: Implement CLI argument parsing and temporary manifest cleanup**

Require `--ipa`, `--bucket`, and `--base-url`; accept optional `--task-id` and `--dry-run`. Inspect the IPA, plan the publish, serialize the manifest into a `TemporaryDirectory`, and print JSON to stdout. In dry-run mode, print the JSON without calling `subprocess.run`. In upload mode, run the two commands with `check=True`, capture output, convert command failures into `PublishError("R2 上传失败，请检查 Wrangler 登录、bucket 和权限")`, and let the temporary directory clean itself up.

- [ ] **Step 3: Run focused tests to verify they pass**

Run:

```powershell
python -m unittest tests.test_publish_ota -v
```

Expected: all tests PASS, including the subprocess-based dry-run test; no Wrangler process is started because the CLI receives `--dry-run`.

- [ ] **Step 4: Run a manual dry-run against the repository IPA**

Run:

```powershell
python tools/publish_ota.py --ipa Orvia-signed.ipa --bucket orvia-install --base-url https://orvia-install.ice329.me --dry-run
```

Expected: valid JSON with `bundleIdentifier` equal to `com.ice.orvia`, task-scoped `ipaUrl` and `manifestUrl`, and an `itms-services://` `installUrl`. The publisher must receive the signed output from the existing workflow; the repository's unsigned `Orvia.ipa` may contain the deferred uppercase Bundle ID and must be rejected during Phase 1.

- [ ] **Step 5: Commit the green CLI implementation**

```powershell
git add tools/publish_ota.py tests/test_publish_ota.py
git -c user.name="Codex" -c user.email="codex@local" commit -m "feat: add safe OTA publisher dry-run"
```

### Task 7: Add the non-destructive OTA runbook

**Files:**
- Create: `docs/operations/orvia-ota-phase1-runbook.md`

**Interfaces:**
- The runbook documents the exact CLI, bucket/key layout, Content-Type checks, iPhone Safari acceptance, and rollback/cleanup boundaries.

- [ ] **Step 1: Write the preflight and dry-run procedure**

Document that the operator must first confirm the new `orvia-install` bucket and separate download hostname, then run the repository-IPA dry-run. Explicitly state that the existing `ice329.me`, `www.ice329.me`, `downloads.ice329.me`, old Workers, and old R2/D1 resources are out of scope.

- [ ] **Step 2: Write the upload and HTTP verification procedure**

Document the real upload command, expected keys under `sign/{taskId}/`, and these checks:

```powershell
curl.exe -I https://orvia-install.ice329.me/sign/<taskId>/Orvia.ipa
curl.exe -I https://orvia-install.ice329.me/sign/<taskId>/manifest.plist
```

Require HTTPS, `application/octet-stream` for IPA, and `application/xml` for manifest before attempting OTA.

- [ ] **Step 3: Write the iPhone acceptance and cleanup procedure**

Document opening the generated `installUrl` in iPhone Safari, confirming iOS installation and app launch, recording the taskId, and deleting only that task's objects if the test must be rolled back. Include the future 24-hour lifecycle cleanup as a Phase 4 item, not as an implicit Phase 1 behavior.

- [ ] **Step 4: Review the runbook for secret safety**

Run:

```powershell
rg -n -i "p12|mobileprovision|password|token|secret|private key" docs/operations/orvia-ota-phase1-runbook.md
```

Expected: only policy statements that secrets are not accepted or stored; no values or credential commands.

- [ ] **Step 5: Commit the runbook**

```powershell
git add docs/operations/orvia-ota-phase1-runbook.md
git -c user.name="Codex" -c user.email="codex@local" commit -m "docs: add Orvia OTA phase 1 runbook"
```

### Task 8: Full verification and handoff

**Files:**
- Verify: `tools/publish_ota.py`
- Verify: `tests/test_publish_ota.py`
- Verify: `docs/operations/orvia-ota-phase1-runbook.md`
- Verify: `.github/workflows/sign.yml`, `Orvia.ipa`

**Interfaces:**
- No additional production behavior; this task produces evidence that the local publisher is isolated from the signing workflow and production Cloudflare resources.

- [ ] **Step 1: Run the complete test suite**

Run:

```powershell
python -m unittest discover -s tests -v
```

Expected: all tests PASS with no test invoking Wrangler or making network requests.

- [ ] **Step 2: Run type/syntax checks available in the repository**

Run:

```powershell
python -m py_compile tools/publish_ota.py tests/test_publish_ota.py
```

Expected: exit code 0 and no generated bytecode files committed.

- [ ] **Step 3: Verify the manual dry-run output and protected files**

Run:

```powershell
python tools/publish_ota.py --ipa Orvia-signed.ipa --bucket orvia-install --base-url https://orvia-install.ice329.me --dry-run
git diff 9fd36ab -- .github/workflows/sign.yml Orvia.ipa
git status --short
```

Expected: dry-run JSON is valid; the workflow and IPA show no diff; only the planned tool, tests, and runbook are present.

- [ ] **Step 4: Record the implementation handoff**

Report the commit hashes, test command and result, the generated task/URL contract, and the external prerequisites for real OTA validation. State explicitly that no Cloudflare resource mutation or iPhone installation was performed by local automation.

## Plan Self-Review

- Spec coverage: IPA metadata extraction is covered by Tasks 1–2; manifest and URL safety by Tasks 3–4; R2 content types and dry-run by Tasks 5–6; manual OTA and existing-domain regression by Task 7; final evidence by Task 8.
- Security coverage: no signing inputs are accepted, no secrets enter command arguments, protected domains are rejected, task IDs isolate every object path, and tests never connect to Cloudflare.
- Bundle ID coverage: lowercase `com.ice.orvia` is enforced in code/tests/docs; uppercase `com.ice.Orvia` is explicitly deferred until after a successful OTA validation.
- No placeholder steps or undefined interfaces remain in the plan.
