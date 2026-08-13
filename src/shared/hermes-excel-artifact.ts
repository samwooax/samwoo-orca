export type ExcelArtifactEngineCapability = {
  name: string
  version: string
  available: boolean
}

export type ExcelArtifactCapability = {
  name: 'excelArtifact'
  protocolVersions: number[]
  actions: ('inspect' | 'create' | 'modify' | 'validate' | 'render' | 'cancel')[]
  inputKinds: ('pptx' | 'pdf' | 'png' | 'jpeg' | 'xlsx')[]
  executionHosts: ['local']
  workbookSpecVersions: number[]
  workbookFeatures: string[]
  create: ExcelArtifactEngineCapability
  modify: ExcelArtifactEngineCapability
  validate: ExcelArtifactEngineCapability
  render: ExcelArtifactEngineCapability
  pptxInspect: boolean
  pdfInspect: boolean
  maxInputBytes: number
  maxTimeoutSeconds: number
}

export type ExcelArtifactInput = {
  kind: 'pptx' | 'pdf' | 'png' | 'jpeg' | 'xlsx'
  artifactId?: string
  path?: string
  sha256?: string
  slides?: number[]
  pages?: number[]
}

export type ExcelArtifactRequest = {
  version: 1
  operationId: string
  idempotencyKey: string
  action: 'inspect' | 'create' | 'modify' | 'validate' | 'render' | 'cancel'
  inputs?: ExcelArtifactInput[]
  output?: { path: string; overwrite: boolean; expectedSha256?: string | null }
  workbookSpec?: Record<string, unknown>
  validation?: {
    openXml: boolean
    formulas: boolean
    charts: boolean
    renderPreview: boolean
  }
  toolchain?: { profile: 'excel-artifact-v1'; version: '1' }
  timeoutSeconds?: number
  jobId?: string
}

export type ExcelArtifactError = {
  code: string
  message: string
  recovery: string
  details: Record<string, unknown>
}

export type ExcelArtifactResult = {
  version?: number
  operationId?: string
  idempotencyKey?: string
  jobId?: string
  action?: string
  state?: 'completed' | 'failed' | 'cancelled'
  output?: { path: string; sha256: string; sizeBytes: number; replaced?: boolean }
  inputs?: Record<string, unknown>[]
  engines?: Record<string, unknown>[]
  sheets?: Record<string, unknown>[]
  tables?: Record<string, unknown>[]
  charts?: Record<string, unknown>[]
  validation?: Record<string, unknown>
  inspection?: Record<string, unknown>[]
  previews?: Record<string, unknown>[]
  warnings?: Record<string, unknown>[]
  error?: ExcelArtifactError
  committed?: boolean
  cleanup?: Record<string, unknown>
  startedAt?: string
  completedAt?: string
  ok?: boolean
}
