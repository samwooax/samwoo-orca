import type {
  ExcelArtifactCapability,
  ExcelArtifactRequest,
  ExcelArtifactResult
} from '../../shared/hermes-excel-artifact'
import { normalizeExcelArtifactRequest } from './hermes-excel-artifact-request-normalizer'
import { parseEnvelopeJson } from './hermes-local-envelope-json-repair'

const OPEN = '<orca_excel_artifact>'
const CLOSE = '</orca_excel_artifact>'
const MAX_ENVELOPE_BYTES = 1024 * 1024
const SAFE_ID = /^[A-Za-z0-9._-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validIdentifier(value: unknown, min: number): value is string {
  return (
    typeof value === 'string' && value.length >= min && value.length <= 128 && SAFE_ID.test(value)
  )
}

export function parseExcelArtifactRequest(reply: string): ExcelArtifactRequest | null {
  const trimmed = reply.trim()
  if (
    Buffer.byteLength(trimmed) > MAX_ENVELOPE_BYTES ||
    !trimmed.startsWith(OPEN) ||
    !trimmed.endsWith(CLOSE)
  ) {
    return null
  }
  const parsed = parseEnvelopeJson(trimmed.slice(OPEN.length, -CLOSE.length))
  if (!parsed) {
    return null
  }
  try {
    const value = parsed.value
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !validIdentifier(value.operationId, 8) ||
      !validIdentifier(value.idempotencyKey, 16) ||
      !['inspect', 'create', 'modify', 'validate', 'render', 'cancel'].includes(
        String(value.action)
      )
    ) {
      return null
    }
    return normalizeExcelArtifactRequest(value)
  } catch {
    return null
  }
}

export function formatExcelArtifactResult(result: ExcelArtifactResult): string {
  return `<orca_excel_artifact_result>${JSON.stringify(result)}</orca_excel_artifact_result>`
}

export function excelArtifactProtocolPrompt(capability: ExcelArtifactCapability | null): string {
  if (!capability) {
    return '[Excel Artifact v1 capability: unavailable]\n<orca_excel_artifact> envelope을 출력하지 마세요.'
  }
  return `
[Excel Artifact v1]
아래 capability는 Orca Electron main이 확인한 로컬 기능입니다.
${JSON.stringify(capability)}
Excel 통합문서를 새로 만들거나 일반 수정할 때만 응답 전체를 다음 envelope 하나로 출력하세요.
<orca_excel_artifact>{"version":1,"operationId":"8자 이상 고유 ID","idempotencyKey":"16자 이상 고유 ID","action":"create|modify|validate",...}</orca_excel_artifact>
toolchain은 {"profile":"excel-artifact-v1","version":"1"}, timeoutSeconds는 1~${capability.maxTimeoutSeconds}입니다.
create의 공통 뼈대는 "output":{"path":"report.xlsx","overwrite":false,"expectedSha256":null}, "validation":{"openXml":true,"formulas":true,"charts":true,"renderPreview":false}입니다. modify에는 정확히 한 XLSX input, 별도 output, preservationPolicy가 있는 workbookSpec, 같은 validation이 필요합니다.
workbookSpec은 version, preservationPolicy, properties, formats, namedRanges, sheets를 사용합니다. 각 sheet는 name과 state가 필수이며 data, cells, columns, rows, merges, freezePane, autofilter, tables, charts, dataValidations, conditionalFormats, images, pageSetup을 사용할 수 있습니다.
preservationPolicy는 "fail_on_unsupported_loss" 또는 "warn_on_unsupported_loss"만 사용하세요. 새 통합문서도 "fail_on_unsupported_loss"를 사용합니다.
columns는 {"range":"A"} 또는 {"range":"A:C","width":20}, rows는 {"index":1,"height":24}, autofilter는 {"range":"A1:C25"} 형식입니다. pageSetup은 orientation, printArea, header, footer, margins, fitToWidth, fitToHeight만 사용합니다.
cells는 address와 value 또는 formula를 사용합니다. formats는 id/font/fill/alignment/border/numberFormat/locked를 사용하고 셀은 formatId로 참조합니다. 첨부 이미지는 images 항목의 artifactPath에 @attachments/... 경로를 사용합니다.
차트는 정확히 다음 형식만 사용하세요: {"type":"bar","title":"제목","series":[{"name":"계열","categories":{"sheet":"Data","range":"B2:B6"},"values":{"sheet":"Data","range":"D2:D6"}}],"position":"F2","width":600,"height":300}. type은 area|bar|column|doughnut|line|pie|scatter, position은 차트를 놓을 anchor 셀 주소이며 width/height는 픽셀 정수(100~4096)입니다. 차트에 x/y inch 좌표나 chartType 같은 다른 필드를 넣지 마세요.
수식이 참조하는 시트는 반드시 같은 workbookSpec의 sheets에 실제로 만들어야 합니다. 존재하지 않는 시트를 참조하면 검증이 실패합니다.
첨부 XLSX는 먼저 로컬 문서 도구로 inspect/extract하여 SHA-256을 얻은 뒤 input에 {"kind":"xlsx","path":"@attachments/...","sha256":"..."}를 사용하세요.
binary, Base64, 절대 경로, shell, package, executable을 요청에 넣지 마세요. 지원되지 않는 기능을 추측하지 말고 capability의 workbookFeatures만 사용하세요.
원본을 수정하지 않는 별도 output이 기본입니다. 도구 결과를 받은 뒤 결과를 근거로 최종 답변하세요.
[Excel Artifact v1 끝]
`.trim()
}
