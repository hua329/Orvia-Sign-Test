from dataclasses import dataclass
from pathlib import Path
import plistlib
import zipfile
import zlib


EXPECTED_BUNDLE_ID: str = "com.ice.orvia"


class PublishError(Exception):
    """A short, user-facing IPA validation failure."""


@dataclass(frozen=True)
class IpaMetadata:
    bundle_identifier: str
    bundle_version: str
    bundle_short_version: str | None
    info_plist_path: str


def _is_info_plist_path(name: str) -> bool:
    parts = name.split("/")
    return (
        len(parts) == 3
        and parts[0] == "Payload"
        and parts[1].endswith(".app")
        and parts[1] != ".app"
        and parts[2] == "Info.plist"
    )


def inspect_ipa(path: Path) -> IpaMetadata:
    ipa_path = Path(path)
    if not ipa_path.is_file() or ipa_path.suffix.lower() != ".ipa":
        raise PublishError("IPA 文件无效")

    try:
        with zipfile.ZipFile(ipa_path) as archive:
            matches = [
                info
                for info in archive.infolist()
                if not info.is_dir() and _is_info_plist_path(info.filename)
            ]
            if len(matches) != 1:
                raise PublishError("无法读取 App 的 Info.plist")

            info_plist = matches[0]
            try:
                plist_bytes = archive.read(info_plist)
            except (KeyError, OSError, RuntimeError, zipfile.BadZipFile, zlib.error) as exc:
                raise PublishError("IPA 文件无效") from exc
    except PublishError:
        raise
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        raise PublishError("IPA 文件无效") from exc

    try:
        plist = plistlib.loads(plist_bytes)
    except Exception as exc:
        raise PublishError("无法读取 App 的 Info.plist") from exc

    if not isinstance(plist, dict):
        raise PublishError("无法读取 App 的 Info.plist")

    bundle_identifier = plist.get("CFBundleIdentifier")
    if bundle_identifier != EXPECTED_BUNDLE_ID:
        raise PublishError(f"Bundle ID 必须为 {EXPECTED_BUNDLE_ID}")

    short_version = plist.get("CFBundleShortVersionString")
    if short_version is not None and not isinstance(short_version, str):
        raise PublishError("无法读取 App 的 Info.plist")

    if "CFBundleVersion" not in plist:
        if short_version is None or not short_version.strip():
            raise PublishError("无法读取 App 的 Info.plist")
        bundle_version = short_version
    else:
        bundle_version = plist["CFBundleVersion"]
        if not isinstance(bundle_version, str) or not bundle_version.strip():
            raise PublishError("无法读取 App 的 Info.plist")

    return IpaMetadata(
        bundle_identifier=bundle_identifier,
        bundle_version=bundle_version,
        bundle_short_version=short_version,
        info_plist_path=info_plist.filename,
    )
