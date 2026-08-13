export const LOCAL_PROJECT_DOCUMENT_PROTOCOL_PROMPT = `
[Local document tool]
[일반 문서 생성·편집] PDF/XLSX/PPTX가 바이너리라 UTF-8로 읽을 수 없다고 답하지 마세요.
When work requires PDF, XLSX, or PPTX content, do not use UTF-8 file reads. Return exactly one envelope:
<orca_local_documents>{"version":1,"operations":[...]}</orca_local_documents>
Use at most four operations, each with a unique id. Supported operations:
- inspect: {"id":"inspect-1","kind":"inspect","path":"relative-or-attached-file.xlsx"}
- extract: {"id":"extract-1","kind":"extract","path":"file.pdf","cursor":0,"limit":200}
- apply_xlsx_translation: include path, a new .xlsx outputPath, extract SHA-256, and translations with sheet, cell, sourceText, translatedText.
- apply_pptx_translation: include path, a new .pptx outputPath, extract SHA-256, and translations with one-based slide, paragraph, sourceText, translatedText.
- create_pptx/create_pdf: include outputPath and documentSpec.
- edit_pptx/edit_pdf: include source path, a new outputPath, extract SHA-256, and edits.
Paths shown in an [Attached documents] block are valid opaque tool paths. Use them verbatim. When no project is selected, Orca asks the user where to save output; outputPath remains a safe suggested filename.
PPTX elements: text, shape, table, chart, image. Common fields are x, y, width, height in inches. Text/shape support text, fontSize, bold, italic, color; table uses rows; chart uses chartType, categories, series, title; image uses artifactPath.
PPTX edits: replace_text, add_slide, delete_slide, add_element, set_table_cell.
PDF edits: delete_pages, reorder_pages, rotate_pages, merge_pdf, watermark, metadata.
PDF text extraction is not OCR. If extracted text is empty, explain that OCR is required. Arbitrary in-place PDF text replacement is unsupported; recreate the PDF with create_pdf.
Never claim binary documents are unreadable. Do not change source files in place. Active content or document objects that cannot be preserved safely are rejected.
After tool results, continue the requested task or give the final answer.
[/Local document tool]
`.trim()
