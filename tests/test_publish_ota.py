import json
import plistlib
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.publish_ota import IpaMetadata, PublishError, inspect_ipa


FIXED_TASK_ID = "00000000-0000-4000-8000-000000000001"


def make_ipa(tempdir, metadata):
    ipa_path = Path(tempdir.name) / "fixture.ipa"
    with zipfile.ZipFile(ipa_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if metadata is not None:
            archive.writestr(
                "Payload/Orvia.app/Info.plist",
                plistlib.dumps(metadata),
            )
    return ipa_path


class InspectIpaTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tempdir.cleanup()

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

    def test_inspect_ipa_rejects_corrupted_compressed_info_plist(self):
        ipa = make_ipa(self.tempdir, {
            "CFBundleIdentifier": "com.ice.orvia",
            "CFBundleVersion": "42",
        })
        with zipfile.ZipFile(ipa) as archive:
            info = archive.getinfo("Payload/Orvia.app/Info.plist")
            self.assertEqual(info.compress_type, zipfile.ZIP_DEFLATED)
            with ipa.open("r+b") as handle:
                handle.seek(info.header_offset + 26)
                name_length, extra_length = struct.unpack("<HH", handle.read(4))
                data_offset = info.header_offset + 30 + name_length + extra_length
                handle.seek(data_offset)
                handle.write(b"\x00" * info.compress_size)

        with self.assertRaisesRegex(PublishError, "IPA 文件无效"):
            inspect_ipa(ipa)


class PublishOtaTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tempdir.cleanup()

    def test_build_manifest_contains_ota_metadata(self):
        from tools.publish_ota import build_manifest

        metadata = IpaMetadata("com.ice.orvia", "42", "1.4.2", "Payload/Orvia.app/Info.plist")
        manifest = plistlib.loads(build_manifest(metadata, "https://orvia-install.ice329.me/sign/t/Orvia.ipa"))
        item = manifest["items"][0]
        self.assertEqual(item["assets"][0]["kind"], "software-package")
        self.assertEqual(item["assets"][0]["url"], "https://orvia-install.ice329.me/sign/t/Orvia.ipa")
        self.assertEqual(item["metadata"]["bundle-identifier"], "com.ice.orvia")
        self.assertEqual(item["metadata"]["bundle-version"], "42")
        self.assertEqual(item["metadata"]["title"], "Orvia")

    def test_build_manifest_escapes_xml_url_values(self):
        from tools.publish_ota import build_manifest

        metadata = IpaMetadata("com.ice.orvia", "42", None, "Payload/Orvia.app/Info.plist")
        xml = build_manifest(metadata, "https://orvia-install.ice329.me/sign/t/Orvia.ipa?x=1&y=2")
        self.assertIn(b"&amp;", xml)
        self.assertEqual(
            plistlib.loads(xml)["items"][0]["assets"][0]["url"],
            "https://orvia-install.ice329.me/sign/t/Orvia.ipa?x=1&y=2",
        )

    def test_upload_commands_set_content_types_and_task_keys(self):
        from tools.publish_ota import build_upload_commands, plan_publish

        metadata = IpaMetadata("com.ice.orvia", "42", "1.4.2", "Payload/Orvia.app/Info.plist")
        plan = plan_publish(metadata, "orvia-install", "https://orvia-install.ice329.me", FIXED_TASK_ID)
        commands = build_upload_commands(plan, Path("signed.ipa"), Path("manifest.plist"))
        self.assertEqual(len(commands), 2)
        self.assertIn("orvia-install/" + plan.ipa_key, " ".join(commands[0]))
        self.assertIn("--content-type=application/octet-stream", commands[0])
        self.assertIn("--content-type=application/xml", commands[1])
        joined = " ".join(" ".join(command) for command in commands)
        for forbidden in ("p12", "mobileprovision", "password", "token"):
            self.assertNotIn(forbidden, joined.lower())

    def test_cli_dry_run_outputs_json_without_running_wrangler(self):
        fixture = make_ipa(self.tempdir, {
            "CFBundleIdentifier": "com.ice.orvia",
            "CFBundleVersion": "42",
            "CFBundleShortVersionString": "1.4.2",
        })
        completed = subprocess.run([
            sys.executable, "tools/publish_ota.py",
            "--ipa", str(fixture),
            "--bucket", "orvia-install",
            "--base-url", "https://orvia-install.ice329.me",
            "--task-id", FIXED_TASK_ID,
            "--dry-run",
        ], check=True, capture_output=True, text=True)
        output = json.loads(completed.stdout)
        self.assertEqual(output["bundleIdentifier"], "com.ice.orvia")
        self.assertTrue(output["installUrl"].startswith("itms-services://"))

    def test_plan_publish_isolates_task_and_builds_install_url(self):
        from tools.publish_ota import plan_publish, PublishPlan

        metadata = IpaMetadata("com.ice.orvia", "42", "1.4.2", "Payload/Orvia.app/Info.plist")
        plan = plan_publish(metadata, "orvia-install", "https://orvia-install.ice329.me", "00000000-0000-4000-8000-000000000001")
        self.assertEqual(plan.ipa_key, "sign/00000000-0000-4000-8000-000000000001/Orvia.ipa")
        self.assertIn("manifest.plist", plan.manifest_url)
        self.assertTrue(plan.install_url.startswith("itms-services://?action=download-manifest&url="))
        self.assertIn("https%3A%2F%2Forvia-install.ice329.me", plan.install_url)

    def test_plan_publish_rejects_existing_ice329_download_domains(self):
        from tools.publish_ota import plan_publish, PublishPlan

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

    def test_plan_publish_rejects_base_url_userinfo(self):
        from tools.publish_ota import plan_publish

        metadata = IpaMetadata("com.ice.orvia", "42", None, "Payload/Orvia.app/Info.plist")
        with self.assertRaises(PublishError):
            plan_publish(metadata, "orvia-install", "https://user:password@example.com")

    def test_plan_publish_rejects_unsafe_base_url_characters(self):
        from tools.publish_ota import plan_publish

        metadata = IpaMetadata("com.ice.orvia", "42", None, "Payload/Orvia.app/Info.plist")
        for base_url in (
            "https://example.com/path with space",
            "https://example.com/path\nwith-control",
            r"https://example.com\unsafe",
        ):
            with self.subTest(base_url=base_url):
                with self.assertRaises(PublishError):
                    plan_publish(metadata, "orvia-install", base_url)
