from pathlib import Path
import unittest


WORKFLOW = Path(__file__).parents[1] / ".github" / "workflows" / "sign.yml"
RUNBOOK = Path(__file__).parents[1] / "docs" / "operations" / "orvia-ota-phase2-runbook.md"


class WorkflowContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")
        cls.runbook = RUNBOOK.read_text(encoding="utf-8")

    def test_accepts_task_id_and_keeps_lowercase_signing_contract(self):
        self.assertIn("task_id:", self.workflow)
        self.assertIn("required: true", self.workflow)
        self.assertIn("Orvia-unsigned.ipa", self.workflow)
        self.assertIn("-b com.ice.orvia", self.workflow)
        self.assertIn("-o Orvia-signed.ipa", self.workflow)
        self.assertNotIn("-b com.ice.Orvia", self.workflow)

    def test_publishes_only_orvia_task_scoped_objects(self):
        self.assertIn("--bucket", self.workflow)
        self.assertIn("orvia-beta", self.workflow)
        self.assertIn("--base-url", self.workflow)
        self.assertIn("https://beta.ice329.me", self.workflow)
        self.assertIn("sign/$TASK_ID/icon.png", self.workflow)
        self.assertIn("sign/$TASK_ID/result.json", self.workflow)
        self.assertIn("sign/$TASK_ID/error.json", self.workflow)
        self.assertIn("--content-type=image/png", self.workflow)
        self.assertIn("--content-type=application/json", self.workflow)

    def test_uses_cloudflare_secrets_without_printing_signing_inputs(self):
        self.assertIn("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}", self.workflow)
        self.assertIn("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}", self.workflow)
        self.assertIn("GITHUB_STEP_SUMMARY", self.workflow)
        self.assertIn("if: always()", self.workflow)
        self.assertIn("rm -f cert.p12 profile.mobileprovision Orvia-signed.ipa icon.png publish-result.json", self.workflow)
        self.assertNotIn('echo "$P12_PASSWORD"', self.workflow)
        self.assertNotIn("cat cert.p12", self.workflow)
        self.assertNotIn("cat profile.mobileprovision", self.workflow)

    def test_documents_only_orvia_secret_and_browser_acceptance_flow(self):
        for value in [
            "ORVIA_ACCESS_TOKEN",
            "ORVIA_SIGNING_ENABLED",
            "GITHUB_TOKEN",
            "CLOUDFLARE_API_TOKEN",
            "CLOUDFLARE_ACCOUNT_ID",
            "https://beta.ice329.me/",
            "/api/status/",
            "wzautotool",
            "wz-auto-updates",
            "com.ice.orvia",
        ]:
            self.assertIn(value, self.runbook)
        self.assertIn("pnpm.cmd dlx wrangler@4.125.0 secret put ORVIA_ACCESS_TOKEN", self.runbook)
        self.assertIn("pnpm.cmd dlx wrangler@4.125.0 secret put ORVIA_SIGNING_ENABLED", self.runbook)
        self.assertIn("`true`", self.runbook)
        self.assertIn("`false`", self.runbook)
        self.assertIn("iPhone Safari", self.runbook)


if __name__ == "__main__":
    unittest.main()
