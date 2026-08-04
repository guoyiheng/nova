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

export type ChartType = 'bar' | 'line' | 'pie' | 'radar' | 'scatter' | 'bubble' | 'heatmap' | 'funnel' | 'none'

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

export type ScheduleKind = 'interval' | 'daily' | 'weekly'

export interface ScheduledTask {
  id: string
  name: string
  question: string
  dataSourceId: string
  dataSourceName: string
  sql: string
  scheduleKind: ScheduleKind
  intervalMinutes: number | null
  timeOfDay: string
  dayOfWeek: number | null
  enabled: boolean
  lastRunAt: string | null
  lastStatus: 'success' | 'error' | null
  lastError: string | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ScheduledTaskInput {
  id?: string
  name: string
  question: string
  dataSourceId: string
  sql: string
  scheduleKind: ScheduleKind
  intervalMinutes?: number | null
  timeOfDay?: string
  dayOfWeek?: number | null
  enabled: boolean
}

export type DashboardCardView = 'chart' | 'table' | 'metric'
export type DashboardCardSpan = 1 | 2 | 3 | 4

export interface DashboardCard {
  id: string
  queryRunId: string
  title: string
  view: DashboardCardView
  span: DashboardCardSpan
}

export interface Dashboard {
  id: string
  name: string
  description: string
  columns: number
  cards: DashboardCard[]
  createdAt: string
  updatedAt: string
}

export interface DashboardInput {
  id?: string
  name: string
  description?: string
  columns: number
  cards: DashboardCard[]
}

export interface DashboardExportInput {
  name: string
  format: 'html' | 'png'
  data: string
}

export interface BootstrapData {
  appVersion: string
  dataSources: DataSource[]
  activeDataSourceId: string | null
  queryRuns: QueryRun[]
  savedSql: SavedSql[]
  modelChannels: ModelChannel[]
  scheduledTasks: ScheduledTask[]
  dashboards: Dashboard[]
}

export interface AskInput {
  queryId: string
  question: string
  displayQuestion?: string
  dataSourceId: string
  modelChannelId: string
  model: string
}

export interface FunnelRecommendation {
  id: string
  name: string
  description: string
  steps: string[]
  reason: string
}

export interface FunnelRecommendationInput {
  dataSourceId: string
  modelChannelId: string
  model: string
  focus?: string
}

export interface SqlQueryInput {
  queryId: string
  sql: string
  dataSourceId: string
  question?: string
  chart?: ChartSpec | null
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
  recommendFunnels: (input: FunnelRecommendationInput) => Promise<FunnelRecommendation[]>
  executeSql: (input: SqlQueryInput) => Promise<QueryRun>
  saveSql: (input: SavedSqlInput) => Promise<SavedSql>
  deleteSavedSql: (id: string) => Promise<void>
  saveScheduledTask: (input: ScheduledTaskInput) => Promise<ScheduledTask>
  deleteScheduledTask: (id: string) => Promise<void>
  runScheduledTask: (id: string) => Promise<ScheduledTask>
  saveDashboard: (input: DashboardInput) => Promise<Dashboard>
  deleteDashboard: (id: string) => Promise<void>
  saveDashboardExport: (input: DashboardExportInput) => Promise<{ canceled: boolean; filePath?: string }>
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
