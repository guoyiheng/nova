import type {
  ChartType,
  DataSource,
  DataSourceInput,
  DatabaseType,
  ModelChannel,
  ModelChannelInput,
  QueryMode,
  QueryRun,
  SavedSql,
} from '../electron/shared/types'

export type Page = 'query' | 'funnels' | 'tasks' | 'history' | 'sources' | 'models' | 'settings'
export type Toast = { tone: 'success' | 'error'; message: string }
export type ResultChartType = Exclude<ChartType, 'none'>
export type CardView = 'chart' | 'table' | 'json' | 'process'

export type SelectOption = {
  value: string
  label: string
  group?: string
  meta?: string
  status?: DataSource['status']
}

export type QueryModelOption = SelectOption & { channelId: string; model: string }

export type ModelProviderPreset = {
  id: 'openai' | 'deepseek' | 'qwen' | 'kimi' | 'glm' | 'siliconflow'
  name: string
  shortName: string
  baseUrl: string
  model: string
  apiKeyPlaceholder: string
}

export type ChartFields = {
  categoryKey: string
  numericKeys: string[]
  xNumericKey: string | null
  yKey: string
  sizeKey: string | null
}

export const CHART_TYPE_OPTIONS: Array<{ value: ResultChartType; label: string }> = [
  { value: 'bar', label: '柱状图' },
  { value: 'line', label: '折线图' },
  { value: 'pie', label: '饼图' },
  { value: 'radar', label: '雷达图' },
  { value: 'scatter', label: '散点图' },
  { value: 'bubble', label: '气泡图' },
  { value: 'heatmap', label: '热力图' },
  { value: 'funnel', label: '漏斗图' },
]

export function savedSqlForSource(items: SavedSql[], dataSourceId: string, search = '') {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  return items.filter((item) => item.dataSourceId === dataSourceId && (
    !normalizedSearch || `${item.name} ${item.sql}`.toLocaleLowerCase().includes(normalizedSearch)
  ))
}

export const DATABASE_TYPES: Array<{ value: DatabaseType; label: string; port: number | null }> = [
  { value: 'demo', label: 'Nova 示例商店', port: null },
  { value: 'postgres', label: 'PostgreSQL', port: 5432 },
  { value: 'mysql', label: 'MySQL', port: 3306 },
  { value: 'mariadb', label: 'MariaDB', port: 3306 },
  { value: 'sqlserver', label: 'SQL Server', port: 1433 },
  { value: 'sqlite', label: 'SQLite', port: null },
]

export const EMPTY_SOURCE: DataSourceInput = {
  name: '默认数据源',
  type: 'postgres',
  host: '127.0.0.1',
  port: 5432,
  database: '',
  username: '',
  password: '',
  sslMode: 'prefer',
  filePath: '',
}

export const EMPTY_MODEL_CHANNEL: ModelChannelInput = {
  name: '默认提供商',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5-mini',
  availableModels: [],
  apiKey: '',
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OA',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DS',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'qwen',
    name: '通义千问',
    shortName: 'QW',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    shortName: 'KM',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.5',
    apiKeyPlaceholder: 'sk-...',
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    shortName: 'GL',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5',
    apiKeyPlaceholder: '填写 API Key',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    shortName: 'SF',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'Qwen/Qwen3-8B',
    apiKeyPlaceholder: 'sk-...',
  },
]

function normalizedBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '').toLocaleLowerCase()
}

export function modelProviderPresetForBaseUrl(baseUrl: string): ModelProviderPreset | null {
  const normalized = normalizedBaseUrl(baseUrl)
  return MODEL_PROVIDER_PRESETS.find((preset) => normalizedBaseUrl(preset.baseUrl) === normalized) ?? null
}

export function applyModelProviderPreset(
  current: ModelChannelInput,
  preset: ModelProviderPreset,
): ModelChannelInput {
  return {
    ...current,
    name: preset.name,
    baseUrl: preset.baseUrl,
    model: preset.model,
    availableModels: [],
  }
}

export const QUERY_SCROLL_POSITION_KEY = 'nova_query_scroll_position'

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatReleaseDate(value?: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value))
}

export function formatBytes(value?: number) {
  if (!value) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / (1024 ** unitIndex)
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`
}

export function initialPage(): Page {
  try {
    const saved = localStorage.getItem('nova_active_page')
    if (saved && ['query', 'funnels', 'tasks', 'history', 'sources', 'models', 'settings'].includes(saved)) return saved as Page
  } catch {
    // ignore
  }
  return 'query'
}

export function initialQueryMode(): QueryMode {
  try {
    const saved = localStorage.getItem('nova_query_mode')
    if (saved === 'smart' || saved === 'sql') return saved
  } catch {
    // ignore
  }
  return 'smart'
}

export function queryModelOptions(channels: ModelChannel[]): QueryModelOption[] {
  return channels.flatMap((channel) => {
    const models = channel.availableModels.includes(channel.model)
      ? channel.availableModels
      : [channel.model, ...channel.availableModels]
    return [...new Set(models)].map((model) => ({
      value: JSON.stringify([channel.id, model]),
      label: model,
      group: channel.name,
      channelId: channel.id,
      model,
    }))
  })
}

export function initialQueryModel() {
  try {
    return localStorage.getItem('nova_query_model') ?? ''
  } catch {
    return ''
  }
}

export function savedQueryScrollPosition(): number | 'bottom' {
  try {
    const saved = localStorage.getItem(QUERY_SCROLL_POSITION_KEY)
    if (saved === 'bottom') return 'bottom'
    const position = Number(saved)
    if (saved !== null && Number.isFinite(position) && position >= 0) return position
  } catch {
    // ignore
  }
  return 'bottom'
}

export function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function inferChartFields(run: QueryRun): ChartFields | null {
  if (!run.table?.rows.length || !run.table.columns.length) return null
  const sample = run.table.rows.slice(0, 50)
  const numericKeys = run.table.columns.filter((column) => {
    const populated = sample.map((row) => row[column]).filter((value) => value !== null && value !== undefined && value !== '')
    if (!populated.length) return false
    return populated.filter((value) => numericValue(value) !== null).length / populated.length >= 0.75
  })
  if (!numericKeys.length) return null

  const requestedX = run.chart?.xKey
  const requestedY = run.chart?.yKey
  const categoryKey = requestedX && run.table.columns.includes(requestedX)
    ? requestedX
    : run.table.columns.find((column) => !numericKeys.includes(column)) ?? run.table.columns[0]
  const yKey = requestedY && numericKeys.includes(requestedY) ? requestedY : numericKeys[0]
  const xNumericKey = requestedX && numericKeys.includes(requestedX) && requestedX !== yKey
    ? requestedX
    : numericKeys.find((column) => column !== yKey) ?? null
  const sizeKey = numericKeys.find((column) => column !== yKey && column !== xNumericKey) ?? null

  return { categoryKey, numericKeys, xNumericKey, yKey, sizeKey }
}

export function inferBestChartType(run: QueryRun): ResultChartType {
  try {
    const saved = localStorage.getItem(`nova_chart_type_${run.id}`)
    if (saved && ['bar', 'line', 'pie', 'radar', 'scatter', 'bubble', 'heatmap', 'funnel'].includes(saved)) {
      return saved as ResultChartType
    }
  } catch {
    // ignore
  }

  if (run.chart?.type && run.chart.type !== 'none') return run.chart.type
  if (!run.table?.rows.length || !run.table.columns.length) return 'bar'

  const fields = inferChartFields(run)
  if (!fields) return 'bar'

  const rows = run.table.rows
  const rowCount = rows.length
  const catKeyLower = fields.categoryKey.toLocaleLowerCase()
  const yKeyLower = fields.yKey.toLocaleLowerCase()
  const isDateKey = /date|time|day|month|year|dt|created|updated|日期|时间|月份|年份|月|日|天/.test(catKeyLower)
  const firstCatVal = String(rows[0]?.[fields.categoryKey] ?? '')
  const looksLikeDateVal = /^\d{4}[-/.]\d{1,2}([-/.]\d{1,2})?$/.test(firstCatVal) || /^\d{4}年/.test(firstCatVal)

  if ((isDateKey || looksLikeDateVal) && rowCount >= 2) return 'line'

  const isRatioKey = /ratio|percent|share|prop|rate|占比|比例|份额|分布/.test(catKeyLower)
    || /ratio|percent|share|prop|rate|占比|比例|份额|分布/.test(yKeyLower)
  if ((isRatioKey || (rowCount >= 2 && rowCount <= 8 && !fields.xNumericKey)) && fields.numericKeys.length === 1) return 'pie'
  if (fields.numericKeys.length >= 3 && rowCount >= 3 && rowCount <= 10) return 'radar'
  if (fields.xNumericKey && fields.sizeKey) return 'bubble'
  if (fields.xNumericKey) return 'scatter'
  return 'bar'
}

export function initialCardView(run: QueryRun, fallback: 'chart' | 'table' = 'chart'): CardView {
  try {
    const saved = localStorage.getItem(`nova_card_view_${run.id}`)
    if (saved && ['table', 'chart', 'json', 'process'].includes(saved)) return saved as CardView
  } catch {
    // ignore
  }
  return run.table?.rows.length ? fallback : run.processLogs.length ? 'process' : fallback
}
