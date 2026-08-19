from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from orca_excel_artifact.errors import ArtifactError
from orca_excel_artifact.validation import render_workbook_pdf


class _SuccessfulProcess:
    pid = 10_001
    returncode = 0

    def __init__(self, target: Path) -> None:
        self.target = target
        self.timeout: float | None = None

    def communicate(self, *, timeout: float) -> tuple[bytes, bytes]:
        self.timeout = timeout
        self.target.write_bytes(b"%PDF-1.4\n% fake preview\n")
        return b"", b""


class _FailingProcess:
    pid = 10_002
    returncode = None

    def __init__(self, failure: BaseException) -> None:
        self.failure = failure

    def communicate(self, *, timeout: float) -> tuple[bytes, bytes]:
        raise self.failure


class WorkbookLibreOfficeRuntimeTests(unittest.TestCase):
    def test_uses_minimal_conversion_environment(self) -> None:
        captured: dict[str, object] = {}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "workbook.xlsx"
            output = root / "output"
            source.write_bytes(b"fixture")
            target = output / "workbook.pdf"
            process = _SuccessfulProcess(target)

            def spawn(**options: object) -> _SuccessfulProcess:
                captured.update(options)
                captured["work"] = Path(str(options["env"]["HOME"])).parent  # type: ignore[index]
                return process

            with (
                patch.dict(
                    os.environ,
                    {
                        "ORCA_PREVIEW_SECRET": "do-not-forward",
                        "PATH": "C:\\attacker",
                        "http_proxy": "http://attacker.invalid",
                    },
                ),
                patch("orca_excel_artifact.validation.subprocess.Popen", side_effect=spawn),
            ):
                rendered = render_workbook_pdf(
                    source,
                    output,
                    timeout_seconds=120,
                    executable=root / "soffice.exe",
                )

            self.assertIsInstance(captured["env"], dict)
            environment = dict(captured["env"])
            allowed_keys = {
                "HOME",
                "TMPDIR",
                "TEMP",
                "TMP",
                "PATH",
                "LANG",
                "LC_ALL",
                "PYTHONDONTWRITEBYTECODE",
                "SAL_USE_VCLPLUGIN",
                "http_proxy",
                "https_proxy",
                "ALL_PROXY",
                "NO_PROXY",
            }
            if os.name == "nt":
                allowed_keys.update({"SystemRoot", "WINDIR"})
            self.assertEqual(rendered, target)
            self.assertEqual(process.timeout, 120)
            self.assertNotIn("ORCA_PREVIEW_SECRET", environment)
            self.assertLessEqual(set(environment), allowed_keys)
            self.assertEqual(environment["PATH"], os.defpath)
            self.assertEqual(environment["PYTHONDONTWRITEBYTECODE"], "1")
            self.assertEqual(environment["SAL_USE_VCLPLUGIN"], "svp")
            self.assertEqual(environment["http_proxy"], "http://127.0.0.1:9")
            self.assertEqual(environment["https_proxy"], "http://127.0.0.1:9")
            self.assertEqual(environment["ALL_PROXY"], "http://127.0.0.1:9")
            self.assertEqual(environment["NO_PROXY"], "")
            self.assertEqual(captured["cwd"], environment["TEMP"])
            self.assertEqual(environment["TEMP"], environment["TMP"])
            self.assertEqual(environment["TEMP"], environment["TMPDIR"])
            self.assertNotEqual(environment["HOME"], environment["TEMP"])
            self.assertFalse(Path(captured["work"]).exists())

    def test_timeout_terminates_process_before_temporary_cleanup(self) -> None:
        captured: dict[str, Path] = {}
        failure = subprocess.TimeoutExpired("soffice", 0.01)
        process = _FailingProcess(failure)

        def spawn(**options: object) -> _FailingProcess:
            captured["work"] = Path(str(options["env"]["HOME"])).parent  # type: ignore[index]
            return process

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "workbook.xlsx"
            source.write_bytes(b"fixture")
            with (
                patch("orca_excel_artifact.validation.subprocess.Popen", side_effect=spawn),
                patch("orca_excel_artifact.validation._terminate_process_tree") as terminate,
                self.assertRaises(ArtifactError) as raised,
            ):
                render_workbook_pdf(
                    source,
                    root / "output",
                    timeout_seconds=0.01,
                    executable=root / "soffice.exe",
                )

        self.assertEqual(raised.exception.code, "timeout")
        terminate.assert_called_once_with(process)
        self.assertFalse(captured["work"].exists())

    def test_process_error_terminates_before_temporary_cleanup(self) -> None:
        captured: dict[str, Path] = {}
        process = _FailingProcess(OSError("conversion failed"))

        def spawn(**options: object) -> _FailingProcess:
            captured["work"] = Path(str(options["env"]["HOME"])).parent  # type: ignore[index]
            return process

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "workbook.xlsx"
            source.write_bytes(b"fixture")
            with (
                patch("orca_excel_artifact.validation.subprocess.Popen", side_effect=spawn),
                patch("orca_excel_artifact.validation._terminate_process_tree") as terminate,
                self.assertRaises(ArtifactError) as raised,
            ):
                render_workbook_pdf(
                    source,
                    root / "output",
                    executable=root / "soffice.exe",
                )

        self.assertEqual(raised.exception.code, "render_failed")
        terminate.assert_called_once_with(process)
        self.assertFalse(captured["work"].exists())


if __name__ == "__main__":
    unittest.main()
