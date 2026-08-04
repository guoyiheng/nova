export type DatabaseType = 'postgres' | 'mysql' | 'mariadb' | 'sqlserver' | 'sqlite' | 'demo'
export type ConnectionStatus = 'untested' | 'connected' | 'failed'
export type AgentStage = 'schema' | 'planning' | 'querying' | 'answering'
export type AgentProgressStatus = 'running' | 'success' | 'error'
export type QueryMode = 'smart' | 'sql'

export interface AgentProgressEvent {
  id: string
  queryId?: string
  stage: AgentStage
  title: string
  detail: string
  queryResult?: QueryTable
  status: AgentProgressStatus
  elapsedMs: number
}

export interface DataSource {
  id: string
  name: string
  type: DatabaseType
  host: string
  port: number | null
  database: string
  username: string
  sslMode: string
  filePath: string
  status: ConnectionStatus
  lastTestedAt: string | null
  createdAt: string
  updatedAt: string
  hasPassword: boolean
}

export interface DataSourceInput {
  id?: string
  name: string
  type: DatabaseType
  host?: string
  port?: number | null
  database?: string
  username?: string
  password?: string
  sslMode?: string
  filePath?: string
}

export type SchemaObjectType = 'table' | 'view' | 'column' | 'procedure' | 'function' | 'index'

export type SchemaObjectCounts = Record<SchemaObjectType, number>

export interface SchemaCacheError {
  schema: string
  objectType: SchemaObjectType
  message: string
}

export interface SchemaCacheInfo {
  dataSourceId: string
  state: 'missing' | 'ready' | 'partial' | 'stale'
  refreshedAt: string | null
  capturedAt: string | null
  sizeBytes: number
  schemaCount: number
  counts: SchemaObjectCounts
  errors: SchemaCacheError[]
}

export interface SchemaColumnInfo {
  name: string
  type: string
  nullable: boolean | null
  description?: string
}

export interface SchemaRelationInfo {
  name: string
  type: 'table' | 'view'
  comment?: string
  columns: SchemaColumnInfo[]
}

export interface SchemaGroupInfo {
  name: string
  relations: SchemaRelationInfo[]
}

export interface SchemaCacheStructure {
  dataSourceId: string
  schemas: SchemaGroupInfo[]
}

export interface ModelSettings {
  baseUrl: string
  model: string
  availableModels: string[]
  hasApiKey: boolean
}

export interface ModelSettingsInput {
  baseUrl: string
  model: string
  apiKey?: string
}

export interface ModelChannel {
  id: string
  name: string
  baseUrl: string
  model: string
  availableModels: string[]
  hasApiKey: boolean
  createdAt: string
  updatedAt: string
}

export interface ModelChannelInput {
  id?: string
  name: string
  baseUrl: string
  model: string
  availableModels?: string[]
  apiKey?: string
}

export interface ModelListInput {
  channelId?: string
  baseUrl: string
  apiKey?: string
}

export interface InitialSetupInput {
  dataSource: DataSourceInput
  modelChannel: ModelChannelInput
}

export interface QueryTable {
  columns: string[]
  rows: Array<Record<string, unknown>>
  truncated: boolean
  affectedRows?: number
}

export type ChartType = 'bar' | 'line' | 'pie' | 'radar' | 'scatter' | 'bubble' | 'heatmap' | 'none'

export interface ChartSpec {
  type: ChartType
  xKey?: string
  yKey?: string
  title?: string
}

export interface QueryRun {
  id: string
  dataSourceId: string
  dataSourceName: string
  question: string
  answer: string
  sql: string
  table: QueryTable | null
  chart: ChartSpec | null
  status: 'success' | 'error'
  error: string | null
  durationMs: number
  mode: QueryMode
  model?: string | null
  processLogs: AgentProgressEvent[]
  isFavorite: boolean
  isPinned: boolean
  createdAt: string
}

export interface SavedSql {
  id: string
  dataSourceId: string
  name: string
  sql: string
  createdAt: string
  updatedAt: string
}

export interface BootstrapData {
  appVersion: string
  dataSources: DataSource[]
  activeDataSourceId: string | null
  queryRuns: QueryRun[]
  savedSql: SavedSql[]
  modelChannels: ModelChannel[]
}

export interface AskInput {
  queryId: string
  question: string
  dataSourceId: string
  modelChannelId: string
  model: string
}

export interface SqlQueryInput {
  queryId: string
  sql: string
  dataSourceId: string
}

export interface SavedSqlInput {
  dataSourceId: string
  name: string
  sql: string
}

export interface BatchImportSqlInput {
  dataSourceId: string
  content: string
}

export interface ImportSummary {
  dataSourcesImported: number
  dataSourcesSkipped: number
  savedSqlImported: number
  savedSqlSkipped: number
  favoriteRunsImported: number
  favoriteRunsSkipped: number
  modelChannelsImported: number
  modelChannelsSkipped: number
}

export type UpdateCheckResult = {
  hasUpdate: boolean
  updateKind?: 'app' | 'renderer'
  currentVersion: string
  latestVersion: string
  releaseName?: string
  releaseNotes?: string
  publishedAt?: string
  downloadUrl?: string
  downloadName?: string
  downloadSize?: number
  htmlUrl?: string
}

export type UpdateDownloadProgress = {
  transferred: number
  total: number | null
  percent: number | null
}

export type UpdateDownloadResult = {
  status: 'downloaded'
  filePath: string
}

export interface BatchImportSqlResult {
  imported: number
  skipped: number
}

export interface NovaApi {
  getBootstrap: () => Promise<BootstrapData>
  saveDataSource: (input: DataSourceInput) => Promise<DataSource>
  deleteDataSource: (id: string) => Promise<void>
  testDataSource: (input: DataSourceInput) => Promise<{ ok: boolean; message: string }>
  chooseDatabaseFile: () => Promise<string | null>
  setActiveDataSource: (id: string) => Promise<void>
  getSchemaCacheInfo: (dataSourceId: string) => Promise<SchemaCacheInfo>
  getSchemaCacheStructure: (dataSourceId: string) => Promise<SchemaCacheStructure>
  rebuildSchemaCache: (dataSourceId: string) => Promise<SchemaCacheInfo>
  resetDemoDatabase: (dataSourceId: string) => Promise<void>
  saveModelChannel: (input: ModelChannelInput) => Promise<ModelChannel>
  deleteModelChannel: (id: string) => Promise<void>
  listModels: (input: ModelListInput) => Promise<string[]>
  completeInitialSetup: (input: InitialSetupInput) => Promise<{ dataSource: DataSource; modelChannel: ModelChannel }>
  ask: (input: AskInput) => Promise<QueryRun>
  executeSql: (input: SqlQueryInput) => Promise<QueryRun>
  saveSql: (input: SavedSqlInput) => Promise<SavedSql>
  deleteSavedSql: (id: string) => Promise<void>
  updateQueryRun: (id: string, patch: { isFavorite?: boolean; isPinned?: boolean; chart?: ChartSpec | null }) => Promise<QueryRun>
  exportConfig: () => Promise<{ canceled: boolean; filePath?: string }>
  importConfig: () => Promise<{ canceled: boolean; summary?: ImportSummary }>
  batchImportSql: (input: BatchImportSqlInput) => Promise<BatchImportSqlResult>
  checkUpdate: () => Promise<UpdateCheckResult>
  downloadUpdate: (downloadUrl: string) => Promise<UpdateDownloadResult>
  applyRendererUpdate: () => Promise<{ version: string }>
  openDownloadedUpdate: () => Promise<void>
  rendererReady: () => Promise<void>
  onUpdateDownloadProgress: (listener: (progress: UpdateDownloadProgress) => void) => () => void
  onAgentProgress: (listener: (progress: AgentProgressEvent) => void) => () => void
}
