import plistlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from tools.publish_ota import IpaMetadata, PublishError, inspect_ipa


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
