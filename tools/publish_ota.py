import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
from typing import Sequence
from urllib.parse import quote, urlparse
import uuid
import zipfile
import zlib


EXPECTED_BUNDLE_ID: str = "com.ice.orvia"
PHASE_ONE_BUCKET: str = "orvia-install"
PHASE_TWO_BUCKET: str = "orvia-beta"
ALLOWED_BUCKETS = frozenset({PHASE_ONE_BUCKET, PHASE_TWO_BUCKET})
IPA_CONTENT_TYPE: str = "application/octet-stream"
MANIFEST_CONTENT_TYPE: str = "application/xml"
WINDOWS_COMMAND_METACHARACTERS = frozenset('&|<>^()%!"')
WRANGLER_ENVIRONMENT_KEYS = (
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "ComSpec",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "CLOUDFLARE_API_TOKEN",
)


class PublishError(Exception):
    """A short, user-facing IPA validation failure."""


def _is_windows() -> bool:
    return os.name == "nt"


def _wrangler_environment(account_id: str | None = None) -> dict[str, str]:
    environment = {
        key: value
        for key in WRANGLER_ENVIRONMENT_KEYS
        if (value := os.environ.get(key)) is not None
    }
    if account_id is not None:
        environment["CLOUDFLARE_ACCOUNT_ID"] = account_id
    return environment


def _validate_account_id(account_id: str | None, *, required: bool) -> str | None:
    if account_id is None:
        if required:
            raise PublishError("非 dry-run 上传必须提供 Cloudflare account ID")
        return None
    if len(account_id) != 32 or any(character not in "0123456789abcdefABCDEF" for character in account_id):
        raise PublishError("Cloudflare account ID 必须为 32 位十六进制字符串")
    return account_id


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
    bucket: str


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
    try:
        ipa_path = Path(path)
        if not ipa_path.is_file() or ipa_path.suffix.lower() != ".ipa":
            raise PublishError("IPA 文件无效")
    except (OSError, RuntimeError, ValueError, TypeError) as exc:
        raise PublishError("IPA 文件无效") from exc

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
    except Exception as exc:
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
    try:
        return plistlib.dumps(payload, fmt=plistlib.FMT_XML, sort_keys=False)
    except (ValueError, TypeError, UnicodeError) as exc:
        raise PublishError("无法生成 OTA manifest") from exc


def plan_publish(
    metadata: IpaMetadata,
    bucket: str,
    base_url: str,
    task_id: str | None = None,
) -> PublishPlan:
    if bucket not in ALLOWED_BUCKETS:
        raise PublishError(f"bucket 必须为 {PHASE_ONE_BUCKET} 或 {PHASE_TWO_BUCKET}")

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

    if hostname and "%" in hostname:
        raise PublishError("公共基址必须为安全的 HTTPS URL")

    protected_hosts = {"ice329.me", "www.ice329.me", "downloads.ice329.me"}
    try:
        normalized_hostname = (
            hostname.encode("idna").decode("ascii").rstrip(".").lower()
            if hostname
            else ""
        )
    except UnicodeError as exc:
        raise PublishError("公共基址必须为安全的 HTTPS URL") from exc
    if (
        parsed_base_url.scheme.lower() != "https"
        or not parsed_base_url.netloc
        or not hostname
        or not normalized_hostname
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
    try:
        install_url = (
            "itms-services://?action=download-manifest&url="
            + quote(manifest_url, safe="")
        )
    except (UnicodeError, ValueError) as exc:
        raise PublishError("安装 URL 无效") from exc

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
        ipa_content_type=IPA_CONTENT_TYPE,
        manifest_content_type=MANIFEST_CONTENT_TYPE,
        bucket=bucket,
    )


def _validate_upload_plan(plan: PublishPlan) -> None:
    if not isinstance(plan, PublishPlan):
        raise PublishError("发布计划无效")
    if plan.bucket not in ALLOWED_BUCKETS:
        raise PublishError("发布计划无效")
    if plan.bundle_identifier != EXPECTED_BUNDLE_ID:
        raise PublishError("发布计划无效")
    if not isinstance(plan.task_id, str):
        raise PublishError("发布计划无效")
    try:
        canonical_task_id = str(uuid.UUID(plan.task_id))
    except (AttributeError, TypeError, ValueError) as exc:
        raise PublishError("发布计划无效") from exc
    if canonical_task_id != plan.task_id:
        raise PublishError("发布计划无效")
    if plan.ipa_key != f"sign/{canonical_task_id}/Orvia.ipa":
        raise PublishError("发布计划无效")
    if plan.manifest_key != f"sign/{canonical_task_id}/manifest.plist":
        raise PublishError("发布计划无效")
    if plan.ipa_content_type != IPA_CONTENT_TYPE:
        raise PublishError("发布计划无效")
    if plan.manifest_content_type != MANIFEST_CONTENT_TYPE:
        raise PublishError("发布计划无效")


def build_upload_commands(
    plan: PublishPlan,
    ipa_path: Path,
    manifest_path: Path,
) -> list[list[str]]:
    _validate_upload_plan(plan)
    is_windows = _is_windows()
    ipa_file = str(ipa_path)
    manifest_file = str(manifest_path)
    if is_windows:
        for file_path in (ipa_file, manifest_file):
            if any(
                ord(character) < 0x20 or character in WINDOWS_COMMAND_METACHARACTERS
                for character in file_path
            ):
                raise PublishError("Windows 文件路径包含不安全字符")

    executable = "npx.cmd" if is_windows else "npx"
    return [
        [
            executable,
            "--yes",
            "wrangler@4.125.0",
            "r2",
            "object",
            "put",
            f"{plan.bucket}/{plan.ipa_key}",
            "--remote",
            f"--file={ipa_file}",
            f"--content-type={plan.ipa_content_type}",
        ],
        [
            executable,
            "--yes",
            "wrangler@4.125.0",
            "r2",
            "object",
            "put",
            f"{plan.bucket}/{plan.manifest_key}",
            "--remote",
            f"--file={manifest_file}",
            f"--content-type={plan.manifest_content_type}",
        ],
    ]


def serialize_result(plan: PublishPlan) -> str:
    result = {
        "taskId": plan.task_id,
        "bundleIdentifier": plan.bundle_identifier,
        "bundleVersion": plan.bundle_version,
        "bundleShortVersion": plan.bundle_short_version,
        "ipaKey": plan.ipa_key,
        "manifestKey": plan.manifest_key,
        "ipaUrl": plan.ipa_url,
        "manifestUrl": plan.manifest_url,
        "installUrl": plan.install_url,
    }
    return json.dumps(result, ensure_ascii=False)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish an Orvia OTA IPA")
    parser.add_argument("--ipa", required=True)
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--task-id")
    parser.add_argument("--account-id")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    try:
        if not args.dry_run and args.task_id is None:
            raise PublishError("非 dry-run 上传必须提供 task_id")

        try:
            ipa_path = Path(args.ipa).resolve()
        except (OSError, RuntimeError) as exc:
            raise PublishError("IPA 文件无效") from exc
        metadata = inspect_ipa(ipa_path)
        plan = plan_publish(metadata, args.bucket, args.base_url, args.task_id)
        account_id = _validate_account_id(args.account_id, required=not args.dry_run)

        try:
            temporary_directory = tempfile.TemporaryDirectory()
        except OSError as exc:
            raise PublishError("无法创建 OTA manifest 临时目录") from exc

        try:
            with temporary_directory as temporary_directory_path:
                manifest_path = Path(temporary_directory_path) / "manifest.plist"
                try:
                    manifest_path.write_bytes(build_manifest(metadata, plan.ipa_url))
                except OSError as exc:
                    raise PublishError("无法写入 OTA manifest") from exc

                if not args.dry_run:
                    environment = _wrangler_environment(account_id)
                    try:
                        for command in build_upload_commands(plan, ipa_path, manifest_path):
                            subprocess.run(
                                command,
                                check=True,
                                capture_output=True,
                                env=environment,
                                cwd=temporary_directory_path,
                                stdin=subprocess.DEVNULL,
                            )
                    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
                        raise PublishError(
                            "R2 上传失败，请检查 wrangler@4.125.0 登录、bucket 和权限"
                        ) from exc
                output = serialize_result(plan)
        except OSError as exc:
            raise PublishError("无法清理 OTA manifest 临时目录") from exc

        print(output)

        return 0
    except PublishError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
