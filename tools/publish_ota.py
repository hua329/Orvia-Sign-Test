from dataclasses import dataclass
from pathlib import Path
import plistlib
from urllib.parse import quote, urlparse
import uuid
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


@dataclass(frozen=True)
class PublishPlan:
    task_id: str
    bundle_identifier: str
    bundle_version: str
    bundle_short_version: str | None
    ipa_key: str
    manifest_key: str
    ipa_url: str
    manifest_url: str
    install_url: str
    ipa_content_type: str
    manifest_content_type: str


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


def build_manifest(metadata: IpaMetadata, ipa_url: str) -> bytes:
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


def plan_publish(
    metadata: IpaMetadata,
    bucket: str,
    base_url: str,
    task_id: str | None = None,
) -> PublishPlan:
    if not isinstance(bucket, str) or not bucket.strip():
        raise PublishError("bucket 不能为空")

    if not isinstance(base_url, str) or not base_url:
        raise PublishError("公共基址必须为 HTTPS URL")

    if any(
        character == "\\"
        or character.isspace()
        or ord(character) < 0x20
        or ord(character) == 0x7F
        for character in base_url
    ):
        raise PublishError("公共基址包含不安全字符")

    try:
        parsed_base_url = urlparse(base_url)
        hostname = parsed_base_url.hostname
        parsed_base_url.port
    except ValueError as exc:
        raise PublishError("公共基址必须为有效的 HTTPS URL") from exc

    protected_hosts = {"ice329.me", "www.ice329.me", "downloads.ice329.me"}
    normalized_hostname = hostname.rstrip(".").lower() if hostname else ""
    if (
        parsed_base_url.scheme.lower() != "https"
        or not parsed_base_url.netloc
        or not hostname
        or parsed_base_url.query
        or parsed_base_url.fragment
        or "?" in base_url
        or "#" in base_url
        or parsed_base_url.username is not None
        or parsed_base_url.password is not None
        or normalized_hostname in protected_hosts
    ):
        raise PublishError("公共基址必须为安全的 HTTPS URL")

    if task_id is None:
        task_id = str(uuid.uuid4())
    elif not isinstance(task_id, str):
        raise PublishError("task_id 必须为有效的 UUID")
    else:
        try:
            task_id = str(uuid.UUID(task_id))
        except (ValueError, AttributeError) as exc:
            raise PublishError("task_id 必须为有效的 UUID") from exc

    normalized_base_url = base_url[:-1] if base_url.endswith("/") else base_url
    ipa_key = f"sign/{task_id}/Orvia.ipa"
    manifest_key = f"sign/{task_id}/manifest.plist"
    ipa_url = f"{normalized_base_url}/{ipa_key}"
    manifest_url = f"{normalized_base_url}/{manifest_key}"
    install_url = (
        "itms-services://?action=download-manifest&url="
        + quote(manifest_url, safe="")
    )

    return PublishPlan(
        task_id=task_id,
        bundle_identifier=metadata.bundle_identifier,
        bundle_version=metadata.bundle_version,
        bundle_short_version=metadata.bundle_short_version,
        ipa_key=ipa_key,
        manifest_key=manifest_key,
        ipa_url=ipa_url,
        manifest_url=manifest_url,
        install_url=install_url,
        ipa_content_type="application/octet-stream",
        manifest_content_type="application/xml",
    )
