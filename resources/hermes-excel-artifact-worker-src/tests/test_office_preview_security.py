from __future__ import annotations

import base64
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

from orca_excel_artifact.errors import ArtifactError
from orca_excel_artifact.validation import inspect_xlsx
from orca_office_preview import run_office_preview


def _clean_workbook(path: Path) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Dashboard"
    sheet.append(["Metric", "Value"])
    sheet.append(["Revenue", 42])
    sheet.column_dimensions["A"].width = 18
    workbook.save(path)
    workbook.close()


def _rewrite_workbook(
    path: Path,
    *,
    additions: dict[str, bytes] | None = None,
    content_type: bytes | None = None,
    relationship: bytes | None = None,
) -> None:
    with zipfile.ZipFile(path, "r") as archive:
        parts = {name: archive.read(name) for name in archive.namelist()}
    if content_type:
        parts["[Content_Types].xml"] = parts["[Content_Types].xml"].replace(
            b"</Types>", content_type + b"</Types>"
        )
    if relationship:
        relationships = parts["xl/_rels/workbook.xml.rels"]
        parts["xl/_rels/workbook.xml.rels"] = relationships.replace(
            b"</Relationships>", relationship + b"</Relationships>"
        )
    parts.update(additions or {})
    rewritten = path.with_suffix(".rewritten.xlsx")
    with zipfile.ZipFile(rewritten, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, payload in sorted(parts.items()):
            archive.writestr(name, payload)
    rewritten.replace(path)


class OfficePreviewSecurityTests(unittest.TestCase):
    def test_clean_xlsx_passes_strict_preview_inspection(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "clean.xlsx"
            _clean_workbook(source)

            metadata = inspect_xlsx(source, reject_unsafe_preview_content=True)

        self.assertEqual(metadata["kind"], "xlsx")
        self.assertEqual(metadata["sheetCount"], 1)

    def test_active_and_external_xlsx_content_is_rejected_before_libreoffice(self) -> None:
        relationship_prefix = (
            b'<Relationship Id="rIdOrcaUnsafe" '
            b'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
        )
        cases = {
            "macro": {"additions": {"xl/vbaProject.bin": b"not executable"}},
            "activex": {"additions": {"xl/activeX/activeX1.bin": b"not executable"}},
            "ole": {"additions": {"xl/embeddings/oleObject1.bin": b"not executable"}},
            "activex_content_type": {
                "content_type": (
                    b'<Override PartName="/custom/active.bin" '
                    b'ContentType="application/vnd.ms-office.activeX+xml"/>'
                )
            },
            "ole_relationship": {
                "relationship": (
                    relationship_prefix
                    + b'oleObject" Target="worksheets/sheet1.xml"/>'
                )
            },
            "external_relationship": {
                "relationship": (
                    relationship_prefix
                    + b'externalLink" Target="https://example.invalid/data.xlsx" '
                    + b'TargetMode="eXtErNaL"/>'
                )
            },
            "external_url_without_mode": {
                "relationship": (
                    relationship_prefix
                    + b'hyperlink" Target="https://example.invalid/data.xlsx"/>'
                )
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, mutation in cases.items():
                with self.subTest(name=name):
                    source = root / f"{name}.xlsx"
                    _clean_workbook(source)
                    _rewrite_workbook(source, **mutation)
                    with patch("orca_office_preview.render_workbook_pdf") as render:
                        with self.assertRaises(ArtifactError) as raised:
                            run_office_preview(
                                {
                                    "sourcePath": str(source),
                                    "libreOfficePath": str(root / "soffice.exe"),
                                    "kind": "xlsx",
                                    "startIndex": 1,
                                    "count": 1,
                                }
                            )
                    self.assertEqual(raised.exception.code, "input_format_invalid")
                    self.assertEqual(raised.exception.details.get("stage"), "preview_security")
                    render.assert_not_called()

    @unittest.skipUnless(
        os.environ.get("ORCA_TEST_LIBREOFFICE"),
        "set ORCA_TEST_LIBREOFFICE to run the real XLSX preview integration",
    )
    def test_real_libreoffice_renders_clean_xlsx(self) -> None:
        office = Path(os.environ["ORCA_TEST_LIBREOFFICE"])
        self.assertTrue(office.is_file())
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "actual.xlsx"
            _clean_workbook(source)

            result = run_office_preview(
                {
                    "sourcePath": str(source),
                    "libreOfficePath": str(office),
                    "kind": "xlsx",
                    "startIndex": 1,
                    "count": 1,
                }
            )

        image = base64.b64decode(result["imageBase64"], validate=True)
        self.assertTrue(result["ok"])
        self.assertEqual(result["kind"], "xlsx")
        self.assertEqual(result["startIndex"], 1)
        self.assertEqual(result["endIndex"], 1)
        self.assertIn(result["mediaType"], {"image/png", "image/jpeg"})
        self.assertLessEqual(len(image), 700 * 1024)
        self.assertLessEqual(result["width"], 1600)
        self.assertLessEqual(result["height"], 1600)


if __name__ == "__main__":
    unittest.main()
