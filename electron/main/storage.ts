import { DatabaseSync } from 'node:sqlite'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import type {
  AgentProgressEvent,
  BootstrapData,
  ChartSpec,
  Dashboard,
  DashboardCard,
  DashboardInput,
  DataSource,
  DataSourceInput,
  ModelChannel,
  ModelChannelInput,
  ModelSettingsInput,
  QueryRun,
  QueryTable,
  SavedSql,
  SavedSqlInput,
  ScheduledTask,
  ScheduledTaskInput,
} from '../shared/types.js'
import { nextScheduledRun } from './scheduler.js'

type DataSourceRow = {
  id: string
  name: string
  type: DataSource['type']
  host: string
  port: number | null
  database_name: string
  username: string
  ssl_mode: string
  file_path: string
  encrypted_password: string | null
  status: DataSource['status']
  last_tested_at: string | null
  created_at: string
  updated_at: string
}

type QueryRunRow = {
  id: string
  data_source_id: string
  data_source_name: string
  question: string
  answer: string
  sql: string
  table_json: string | null
  chart_json: string | null
  status: QueryRun['status']
  error: string | null
  duration_ms: number
  mode: QueryRun['mode']
  model: string | null
  process_json: string | null
  is_favorite: number
  is_pinned: number
  created_at: string
}

type SavedSqlRow = {
  id: string
  data_source_id: string
  name: string
  sql: string
  created_at: string
  updated_at: string
}

type ModelChannelRow = {
  id: string
  name: string
  base_url: string
  model: string
  model_list_json: string
  encrypted_api_key: string | null
  created_at: string
  updated_at: string
}

type ScheduledTaskRow = {
  id: string
  name: string
  data_source_id: string
  sql: string
  schedule_kind: ScheduledTask['scheduleKind']
  interval_minutes: number | null
  time_of_day: string
  day_of_week: number | null
  enabled: number
  last_run_at: string | null
  last_status: ScheduledTask['lastStatus']
  last_error: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

type DashboardRow = {
  id: string
  name: string
  description: string
  cards_json: string
  created_at: string
  updated_at: string
}

const LOCAL_CREDENTIAL_PREFIX = 'local:v1:'
const LOCAL_CREDENTIAL_AAD = Buffer.from('nova-local-credentials-v1')

function readCredentialKey(keyPath: string): Buffer {
  const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64')
  if (key.length !== 32) throw new Error('Nova 本地凭据密钥无效，请重新填写数据库密码和模型 API Key。')
  try {
    chmodSync(keyPath, 0o600)
  } catch {
    // File modes are not supported on every platform.
  }
  return key
}

function loadCredentialKey(databasePath: string): Buffer {
  if (databasePath === ':memory:') return randomBytes(32)
  const keyPath = `${databasePath}.credentials.key`
  try {
    return readCredentialKey(keyPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const key = randomBytes(32)
  try {
    writeFileSync(keyPath, key.toString('base64'), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return readCredentialKey(keyPath)
    throw new Error('无法创建 Nova 本地凭据密钥，请检查应用数据目录权限。', { cause: error })
  }
}

function parseProcessLogs(value: string | null): AgentProgressEvent[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is AgentProgressEvent => (
      typeof item === 'object' && item !== null
      && typeof (item as AgentProgressEvent).id === 'string'
      && typeof (item as AgentProgressEvent).title === 'string'
      && typeof (item as AgentProgressEvent).detail === 'string'
    )) : []
  } catch {
    return []
  }
}

export function uniqueImportedName(name: string, existingNames: Set<string>, maxLength = 80): string {
  const baseName = name.trim()
  let candidate = baseName.slice(0, maxLength)
  let suffixNumber = 1
  while (existingNames.has(candidate.toLocaleLowerCase())) {
    const suffix = `（${suffixNumber}）`
    candidate = `${baseName.slice(0, Math.max(0, maxLength - suffix.length))}${suffix}`
    suffixNumber += 1
  }
  existingNames.add(candidate.toLocaleLowerCase())
  return candidate
}

export class Storage {
  private readonly db: DatabaseSync
  private readonly credentialKey: Buffer

  constructor(databasePath: string) {
    this.credentialKey = loadCredentialKey(databasePath)
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS data_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        host TEXT NOT NULL DEFAULT '',
        port INTEGER,
        database_name TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL DEFAULT '',
        ssl_mode TEXT NOT NULL DEFAULT 'prefer',
        file_path TEXT NOT NULL DEFAULT '',
        encrypted_password TEXT,
        status TEXT NOT NULL DEFAULT 'untested',
        last_tested_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS query_runs (
        id TEXT PRIMARY KEY,
        data_source_id TEXT NOT NULL,
        data_source_name TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        sql TEXT NOT NULL,
        table_json TEXT,
        chart_json TEXT,
        status TEXT NOT NULL,
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'smart',
        process_json TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_query_runs_created_at ON query_runs(created_at DESC);
      CREATE TABLE IF NOT EXISTS saved_sql (
        id TEXT PRIMARY KEY,
        data_source_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sql TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_saved_sql_source ON saved_sql(data_source_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS model_channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        model_list_json TEXT NOT NULL DEFAULT '[]',
        encrypted_api_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS schema_cache (
        data_source_id TEXT PRIMARY KEY,
        schema_json TEXT NOT NULL,
        refreshed_at TEXT NOT NULL,
        FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data_source_id TEXT NOT NULL,
        sql TEXT NOT NULL,
        schedule_kind TEXT NOT NULL,
        interval_minutes INTEGER,
        time_of_day TEXT NOT NULL DEFAULT '09:00',
        day_of_week INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        last_status TEXT,
        last_error TEXT,
        next_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due ON scheduled_tasks(enabled, next_run_at);
      CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        cards_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)

    const queryRunColumns = this.db.prepare('PRAGMA table_info(query_runs)').all() as unknown as Array<{ name: string }>
    if (!queryRunColumns.some((column) => column.name === 'mode')) {
      this.db.exec("ALTER TABLE query_runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'smart'")
    }
    if (!queryRunColumns.some((column) => column.name === 'model')) {
      this.db.exec('ALTER TABLE query_runs ADD COLUMN model TEXT')
    }
    if (!queryRunColumns.some((column) => column.name === 'process_json')) {
      this.db.exec('ALTER TABLE query_runs ADD COLUMN process_json TEXT')
    }
    if (queryRunColumns.some((column) => column.name === 'dashboard_id')) {
      this.db.exec('ALTER TABLE query_runs DROP COLUMN dashboard_id')
    }

    const dashboardColumns = this.db.prepare('PRAGMA table_info(dashboards)').all() as unknown as Array<{ name: string }>
    if (dashboardColumns.length && !dashboardColumns.some((column) => column.name === 'cards_json')) {
      this.db.exec(`
        DROP TABLE dashboards;
        CREATE TABLE dashboards (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          cards_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `)
    }

    const savedSqlColumns = this.db.prepare('PRAGMA table_info(saved_sql)').all() as unknown as Array<{ name: string; notnull: number }>
    const savedSqlSourceColumn = savedSqlColumns.find((column) => column.name === 'data_source_id')
    if (savedSqlSourceColumn && !savedSqlSourceColumn.notnull) {
      const configuredSourceId = this.getSetting('activeDataSourceId')
      const configuredSource = configuredSourceId
        ? this.db.prepare('SELECT id FROM data_sources WHERE id = ?').get(configuredSourceId) as { id: string } | undefined
        : undefined
      const fallbackSource = configuredSource ?? this.db.prepare(
        'SELECT id FROM data_sources ORDER BY created_at ASC LIMIT 1',
      ).get() as { id: string } | undefined
      if (fallbackSource) {
        this.db.prepare('UPDATE saved_sql SET data_source_id = ? WHERE data_source_id IS NULL').run(fallbackSource.id)
      }
      const unboundCount = this.db.prepare(
        'SELECT COUNT(*) AS count FROM saved_sql WHERE data_source_id IS NULL',
      ).get() as { count: number }
      if (unboundCount.count === 0) {
        this.db.exec('PRAGMA foreign_keys = OFF')
        try {
          this.db.exec(`
            BEGIN;
            CREATE TABLE saved_sql_next (
              id TEXT PRIMARY KEY,
              data_source_id TEXT NOT NULL,
              name TEXT NOT NULL,
              sql TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
            );
            INSERT INTO saved_sql_next SELECT * FROM saved_sql;
            DROP TABLE saved_sql;
            ALTER TABLE saved_sql_next RENAME TO saved_sql;
            CREATE INDEX idx_saved_sql_source ON saved_sql(data_source_id, updated_at DESC);
            COMMIT;
          `)
        } catch (error) {
          this.db.exec('ROLLBACK')
          throw error
        } finally {
          this.db.exec('PRAGMA foreign_keys = ON')
        }
      }
    }

    const channelCount = this.db.prepare('SELECT COUNT(*) AS count FROM model_channels').get() as { count: number }
    const legacyConfigured = this.getSetting('modelBaseUrl') || this.getSetting('modelName') || this.getSetting('modelApiKey')
    if (channelCount.count === 0 && legacyConfigured) {
      const now = new Date().toISOString()
      const baseUrl = this.getSetting('modelBaseUrl') ?? 'https://api.openai.com/v1'
      const model = this.getSetting('modelName') ?? 'gpt-5-mini'
      const modelList = this.getSetting('modelListBaseUrl') === baseUrl.replace(/\/$/, '')
        ? this.getSetting('modelList') ?? '[]'
        : '[]'
      this.db.prepare(`
        INSERT INTO model_channels (id, name, base_url, model, model_list_json, encrypted_api_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), '默认提供商', baseUrl, model, modelList, this.getSetting('modelApiKey'), now, now)
    }
  }

  private encrypt(value: string): string {
    if (!value) return ''
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.credentialKey, iv)
    cipher.setAAD(LOCAL_CREDENTIAL_AAD)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return `${LOCAL_CREDENTIAL_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`
  }

  private decrypt(value: string | null, credentialName: string): string {
    if (!value) return ''
    try {
      if (!value.startsWith(LOCAL_CREDENTIAL_PREFIX)) throw new Error('legacy credential')
      const [ivValue, authTagValue, encryptedValue] = value.slice(LOCAL_CREDENTIAL_PREFIX.length).split(':')
      if (!ivValue || !authTagValue || encryptedValue === undefined) throw new Error('invalid credential')
      const decipher = createDecipheriv('aes-256-gcm', this.credentialKey, Buffer.from(ivValue, 'base64'))
      decipher.setAAD(LOCAL_CREDENTIAL_AAD)
      decipher.setAuthTag(Buffer.from(authTagValue, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64')), decipher.final()]).toString('utf8')
    } catch {
      throw new Error(`无法解密${credentialName}，请重新填写并保存。`)
    }
  }

  private canDecrypt(value: string | null): boolean {
    if (!value || !value.startsWith(LOCAL_CREDENTIAL_PREFIX)) return false
    try {
      this.decrypt(value, '凭据')
      return true
    } catch {
      return false
    }
  }

  private getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  private setSetting(key: string, value: string) {
    this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value)
  }

  listDataSources(): DataSource[] {
    const rows = this.db.prepare('SELECT * FROM data_sources ORDER BY created_at ASC').all() as unknown as DataSourceRow[]
    return rows.map((row) => this.mapDataSource(row))
  }

  getDataSource(id: string): DataSource | null {
    const row = this.db.prepare('SELECT * FROM data_sources WHERE id = ?').get(id) as DataSourceRow | undefined
    return row ? this.mapDataSource(row) : null
  }

  getDataSourceSecret(id: string): string {
    const row = this.db.prepare('SELECT name, encrypted_password FROM data_sources WHERE id = ?').get(id) as
      | { name: string; encrypted_password: string | null }
      | undefined
    return this.decrypt(row?.encrypted_password ?? null, `数据源“${row?.name ?? '未知'}”的密码`)
  }

  saveDataSource(input: DataSourceInput): DataSource {
    const existing = input.id ? this.getDataSource(input.id) : null
    const id = existing?.id ?? randomUUID()
    const now = new Date().toISOString()
    const existingSecret = input.id
      ? (this.db.prepare('SELECT encrypted_password FROM data_sources WHERE id = ?').get(input.id) as
          | { encrypted_password: string | null }
          | undefined)?.encrypted_password ?? null
      : null
    const secret = input.password ? this.encrypt(input.password) : existingSecret

    this.db.prepare(`
      INSERT INTO data_sources (
        id, name, type, host, port, database_name, username, ssl_mode, file_path,
        encrypted_password, status, last_tested_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested', NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, type = excluded.type, host = excluded.host,
        port = excluded.port, database_name = excluded.database_name,
        username = excluded.username, ssl_mode = excluded.ssl_mode,
        file_path = excluded.file_path, encrypted_password = excluded.encrypted_password,
        status = 'untested', last_tested_at = NULL, updated_at = excluded.updated_at
    `).run(
      id,
      input.name.trim() || '默认数据源',
      input.type,
      input.host?.trim() ?? '',
      input.port ?? null,
      input.database?.trim() ?? '',
      input.username?.trim() ?? '',
      input.sslMode ?? 'prefer',
      input.filePath?.trim() ?? '',
      secret,
      existing?.createdAt ?? now,
      now,
    )

    this.db.prepare('DELETE FROM schema_cache WHERE data_source_id = ?').run(id)
    this.db.prepare('UPDATE saved_sql SET data_source_id = ? WHERE data_source_id IS NULL').run(id)

    if (!this.getActiveDataSourceId()) this.setActiveDataSource(id)
    return this.getDataSource(id)!
  }

  deleteDataSource(id: string) {
    this.db.prepare('DELETE FROM data_sources WHERE id = ?').run(id)
    if (this.getActiveDataSourceId() === id) {
      this.setSetting('activeDataSourceId', this.listDataSources()[0]?.id ?? '')
    }
  }

  getSchemaCache(dataSourceId: string): string | null {
    return this.getSchemaCacheRecord(dataSourceId)?.schemaJson ?? null
  }

  getSchemaCacheRecord(dataSourceId: string): { schemaJson: string; refreshedAt: string } | null {
    const row = this.db.prepare('SELECT schema_json, refreshed_at FROM schema_cache WHERE data_source_id = ?').get(dataSourceId) as
      | { schema_json: string; refreshed_at: string }
      | undefined
    return row ? { schemaJson: row.schema_json, refreshedAt: row.refreshed_at } : null
  }

  saveSchemaCache(dataSourceId: string, schemaJson: string) {
    this.db.prepare(`
      INSERT INTO schema_cache (data_source_id, schema_json, refreshed_at) VALUES (?, ?, ?)
      ON CONFLICT(data_source_id) DO UPDATE SET
        schema_json = excluded.schema_json,
        refreshed_at = excluded.refreshed_at
    `).run(dataSourceId, schemaJson, new Date().toISOString())
  }

  clearSchemaCache(dataSourceId: string) {
    this.db.prepare('DELETE FROM schema_cache WHERE data_source_id = ?').run(dataSourceId)
  }

  updateDataSourceStatus(id: string, status: DataSource['status']) {
    this.db.prepare('UPDATE data_sources SET status = ?, last_tested_at = ?, updated_at = ? WHERE id = ?').run(
      status,
      new Date().toISOString(),
      new Date().toISOString(),
      id,
    )
  }

  getActiveDataSourceId(): string | null {
    return this.getSetting('activeDataSourceId') || null
  }

  setActiveDataSource(id: string) {
    this.setSetting('activeDataSourceId', id)
  }

  listModelChannels(): ModelChannel[] {
    const rows = this.db.prepare('SELECT * FROM model_channels ORDER BY created_at ASC').all() as unknown as ModelChannelRow[]
    return rows.map((row) => this.mapModelChannel(row))
  }

  getModelChannel(id: string): ModelChannel | null {
    const row = this.db.prepare('SELECT * FROM model_channels WHERE id = ?').get(id) as ModelChannelRow | undefined
    return row ? this.mapModelChannel(row) : null
  }

  getModelChannelApiKey(id: string): string {
    const row = this.db.prepare('SELECT name, encrypted_api_key FROM model_channels WHERE id = ?').get(id) as
      | { name: string; encrypted_api_key: string | null }
      | undefined
    return this.decrypt(row?.encrypted_api_key ?? null, `模型提供商“${row?.name ?? '未知'}”的 API Key`)
  }

  saveModelChannel(input: ModelChannelInput): ModelChannel {
    const existing = input.id ? this.getModelChannel(input.id) : null
    const existingRow = input.id
      ? this.db.prepare('SELECT encrypted_api_key FROM model_channels WHERE id = ?').get(input.id) as { encrypted_api_key: string | null } | undefined
      : undefined
    const id = existing?.id ?? randomUUID()
    const now = new Date().toISOString()
    const baseUrl = input.baseUrl.replace(/\/$/, '')
    const availableModels = input.availableModels !== undefined
      ? [...new Set(input.availableModels.map((model) => model.trim()).filter(Boolean))]
      : existing?.baseUrl === baseUrl ? existing.availableModels : []
    const encryptedApiKey = input.apiKey ? this.encrypt(input.apiKey) : existingRow?.encrypted_api_key ?? null
    this.db.prepare(`
      INSERT INTO model_channels (id, name, base_url, model, model_list_json, encrypted_api_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        base_url = excluded.base_url,
        model = excluded.model,
        model_list_json = excluded.model_list_json,
        encrypted_api_key = excluded.encrypted_api_key,
        updated_at = excluded.updated_at
    `).run(id, input.name.trim() || '默认提供商', baseUrl, input.model.trim(), JSON.stringify(availableModels), encryptedApiKey, existing?.createdAt ?? now, now)
    return this.getModelChannel(id)!
  }

  deleteModelChannel(id: string) {
    this.db.prepare('DELETE FROM model_channels WHERE id = ?').run(id)
  }

  importModelSettings(input: ModelSettingsInput) {
    const existing = this.listModelChannels().find((channel) => channel.name.toLocaleLowerCase() === '默认提供商')
    this.saveModelChannel({
      id: existing?.id,
      name: '默认提供商',
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
    })
    return { imported: 1, skipped: 0 }
  }

  importModelChannels(items: ModelChannelInput[]) {
    const existingByName = new Map(this.listModelChannels().map((channel) => [channel.name.toLocaleLowerCase(), channel]))
    let imported = 0
    for (const item of items) {
      const name = item.name.trim()
      const existing = existingByName.get(name.toLocaleLowerCase())
      const saved = this.saveModelChannel({ ...item, id: existing?.id, name })
      existingByName.set(name.toLocaleLowerCase(), saved)
      imported += 1
    }
    return { imported, skipped: 0 }
  }

  completeInitialSetup(dataSource: DataSourceInput, modelChannel: ModelChannelInput) {
    this.db.exec('BEGIN')
    try {
      const savedDataSource = this.saveDataSource(dataSource)
      const savedModelChannel = this.saveModelChannel(modelChannel)
      this.db.exec('COMMIT')
      return { dataSource: savedDataSource, modelChannel: savedModelChannel }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listQueryRuns(): QueryRun[] {
    const rows = this.db.prepare(
      'SELECT * FROM query_runs ORDER BY is_pinned DESC, created_at DESC LIMIT 200',
    ).all() as unknown as QueryRunRow[]
    return rows.map(this.mapQueryRun)
  }

  getQueryRun(id: string): QueryRun | null {
    const row = this.db.prepare('SELECT * FROM query_runs WHERE id = ?').get(id) as QueryRunRow | undefined
    return row ? this.mapQueryRun(row) : null
  }

  saveQueryRun(run: Omit<QueryRun, 'id' | 'createdAt' | 'isFavorite' | 'isPinned' | 'processLogs'> & { processLogs?: AgentProgressEvent[] }): QueryRun {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO query_runs (
        id, data_source_id, data_source_name, question, answer, sql,
        table_json, chart_json, status, error, duration_ms, mode, model, process_json, is_favorite, is_pinned, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).run(
      id,
      run.dataSourceId,
      run.dataSourceName,
      run.question,
      run.answer,
      run.sql,
      run.table ? JSON.stringify(run.table) : null,
      run.chart ? JSON.stringify(run.chart) : null,
      run.status,
      run.error,
      run.durationMs,
      run.mode,
      run.model ?? null,
      run.processLogs?.length ? JSON.stringify(run.processLogs) : null,
      now,
    )
    return this.getQueryRun(id)!
  }

  updateQueryRun(id: string, patch: { isFavorite?: boolean; isPinned?: boolean; chart?: ChartSpec | null }): QueryRun {
    const current = this.getQueryRun(id)
    if (!current) throw new Error('查询记录不存在。')
    const isFavorite = patch.isFavorite ?? current.isFavorite
    const isPinned = patch.isPinned ?? current.isPinned
    const chart = patch.chart !== undefined ? patch.chart : current.chart
    this.db.prepare('UPDATE query_runs SET is_favorite = ?, is_pinned = ?, chart_json = ? WHERE id = ?').run(
      isFavorite ? 1 : 0,
      isPinned ? 1 : 0,
      chart ? JSON.stringify(chart) : null,
      id,
    )
    return this.getQueryRun(id)!
  }

  listSavedSql(): SavedSql[] {
    const rows = this.db.prepare(
      'SELECT * FROM saved_sql WHERE data_source_id IS NOT NULL ORDER BY updated_at DESC',
    ).all() as unknown as SavedSqlRow[]
    return rows.map(this.mapSavedSql)
  }

  saveSql(input: SavedSqlInput): SavedSql {
    if (!this.getDataSource(input.dataSourceId)) throw new Error('数据源不存在。')
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(
      'INSERT INTO saved_sql (id, data_source_id, name, sql, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, input.dataSourceId, input.name.trim(), input.sql.trim(), now, now)
    return this.listSavedSql().find((item) => item.id === id)!
  }

  deleteSavedSql(id: string) {
    this.db.prepare('DELETE FROM saved_sql WHERE id = ?').run(id)
  }

  listScheduledTasks(): ScheduledTask[] {
    const rows = this.db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at ASC').all() as unknown as ScheduledTaskRow[]
    return rows.map((row) => this.mapScheduledTask(row))
  }

  getScheduledTask(id: string): ScheduledTask | null {
    const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTaskRow | undefined
    return row ? this.mapScheduledTask(row) : null
  }

  saveScheduledTask(input: ScheduledTaskInput): ScheduledTask {
    if (!this.getDataSource(input.dataSourceId)) throw new Error('数据源不存在。')
    const existing = input.id ? this.getScheduledTask(input.id) : null
    const id = existing?.id ?? randomUUID()
    const now = new Date()
    const nextRunAt = input.enabled ? nextScheduledRun({
      scheduleKind: input.scheduleKind,
      intervalMinutes: input.intervalMinutes ?? null,
      timeOfDay: input.timeOfDay ?? '09:00',
      dayOfWeek: input.dayOfWeek ?? null,
    }, now).toISOString() : null
    this.db.prepare(`
      INSERT INTO scheduled_tasks (
        id, name, data_source_id, sql, schedule_kind, interval_minutes, time_of_day, day_of_week,
        enabled, last_run_at, last_status, last_error, next_run_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        data_source_id = excluded.data_source_id,
        sql = excluded.sql,
        schedule_kind = excluded.schedule_kind,
        interval_minutes = excluded.interval_minutes,
        time_of_day = excluded.time_of_day,
        day_of_week = excluded.day_of_week,
        enabled = excluded.enabled,
        next_run_at = excluded.next_run_at,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.name.trim(),
      input.dataSourceId,
      input.sql.trim(),
      input.scheduleKind,
      input.scheduleKind === 'interval' ? input.intervalMinutes ?? 60 : null,
      input.timeOfDay ?? '09:00',
      input.scheduleKind === 'weekly' ? input.dayOfWeek ?? 1 : null,
      input.enabled ? 1 : 0,
      existing?.lastRunAt ?? null,
      existing?.lastStatus ?? null,
      existing?.lastError ?? null,
      nextRunAt,
      existing?.createdAt ?? now.toISOString(),
      now.toISOString(),
    )
    return this.getScheduledTask(id)!
  }

  deleteScheduledTask(id: string) {
    this.db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
  }

  listDueScheduledTasks(now = new Date()): ScheduledTask[] {
    const rows = this.db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
      ORDER BY next_run_at ASC
    `).all(now.toISOString()) as unknown as ScheduledTaskRow[]
    return rows.map((row) => this.mapScheduledTask(row))
  }

  completeScheduledTask(id: string, status: NonNullable<ScheduledTask['lastStatus']>, error: string | null, completedAt = new Date()): ScheduledTask {
    const task = this.getScheduledTask(id)
    if (!task) throw new Error('定时任务不存在。')
    const nextRunAt = task.enabled ? nextScheduledRun(task, completedAt).toISOString() : null
    this.db.prepare(`
      UPDATE scheduled_tasks
      SET last_run_at = ?, last_status = ?, last_error = ?, next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(completedAt.toISOString(), status, error, nextRunAt, completedAt.toISOString(), id)
    return this.getScheduledTask(id)!
  }

  listDashboards(): Dashboard[] {
    const rows = this.db.prepare('SELECT * FROM dashboards ORDER BY updated_at DESC').all() as unknown as DashboardRow[]
    return rows.map((row) => this.mapDashboard(row))
  }

  getDashboard(id: string): Dashboard | null {
    const row = this.db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id) as DashboardRow | undefined
    return row ? this.mapDashboard(row) : null
  }

  saveDashboard(input: DashboardInput): Dashboard {
    const existing = input.id ? this.getDashboard(input.id) : null
    const id = existing?.id ?? randomUUID()
    const now = new Date().toISOString()
    this.db.prepare(`
      INSERT INTO dashboards (id, name, description, cards_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        cards_json = excluded.cards_json,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.name.trim(),
      input.description?.trim() ?? '',
      JSON.stringify(input.cards),
      existing?.createdAt ?? now,
      now,
    )
    return this.getDashboard(id)!
  }

  deleteDashboard(id: string) {
    this.db.prepare('DELETE FROM dashboards WHERE id = ?').run(id)
  }

  exportableConfig() {
    const sources = this.listDataSources()
    const sourceNames = new Map(sources.map((source) => [source.id, source.name]))
    const favoriteRows = this.db.prepare(
      'SELECT * FROM query_runs WHERE is_favorite = 1 ORDER BY created_at DESC',
    ).all() as unknown as QueryRunRow[]
    const config = {
      format: 'nova-config',
      version: 6,
      exportedAt: new Date().toISOString(),
      dataSources: sources.map(({ id, hasPassword: _hasPassword, status: _status, lastTestedAt: _lastTestedAt, createdAt: _createdAt, updatedAt: _updatedAt, ...source }) => ({
        ...source,
        filePath: source.type === 'demo' ? '' : source.filePath,
        password: this.getDataSourceSecret(id),
      })),
      modelChannels: this.listModelChannels().map(({ id, hasApiKey: _hasApiKey, createdAt: _createdAt, updatedAt: _updatedAt, ...channel }) => ({
        ...channel,
        apiKey: this.getModelChannelApiKey(id),
      })),
      savedSql: this.listSavedSql().map((item) => ({
        dataSourceName: sourceNames.get(item.dataSourceId)!,
        name: item.name,
        sql: item.sql,
      })),
      /* Kept as a non-enumerable compatibility property for callers using the in-process API.
         It is intentionally omitted from the exported JSON configuration. */
      favoriteRuns: favoriteRows.map((row) => ({
        dataSourceName: row.data_source_name,
        question: row.question,
        answer: row.answer,
        sql: row.sql,
        chart: row.chart_json ? (JSON.parse(row.chart_json) as ChartSpec) : null,
        status: row.status,
        error: row.error,
        durationMs: row.duration_ms,
        mode: row.mode ?? 'smart',
        model: row.model ?? null,
        createdAt: row.created_at,
      })),
    }
    Object.defineProperty(config, 'favoriteRuns', { enumerable: false, value: config.favoriteRuns })
    return config
  }

  importConfiguration(
    items: DataSourceInput[],
    savedSql: Array<{ dataSourceName: string | null; name: string; sql: string }>,
    favoriteRuns: Array<{
      dataSourceName: string; question: string; answer: string; sql: string
      chart: ChartSpec | null; status: QueryRun['status']; error: string | null
      durationMs: number; mode: QueryRun['mode']; model: string | null; createdAt: string
    }>,
  ): { dataSourcesImported: number; dataSourcesSkipped: number; savedSqlImported: number; savedSqlSkipped: number; favoriteRunsImported: number; favoriteRunsSkipped: number } {
    let dataSourcesImported = 0
    const existingSources = this.listDataSources()
    const existingSourcesByName = new Map(existingSources.map((source) => [source.name.toLocaleLowerCase(), source]))
    const sourceIds = new Map(existingSources.map((source) => [source.name.toLocaleLowerCase(), source.id]))
    for (const item of items) {
      const name = item.name.trim()
      const existing = existingSourcesByName.get(name.toLocaleLowerCase())
      const source = this.saveDataSource({ ...item, id: existing?.id, name })
      existingSourcesByName.set(name.toLocaleLowerCase(), source)
      sourceIds.set(name.toLocaleLowerCase(), source.id)
      dataSourcesImported += 1
    }

    const currentSavedSql = this.listSavedSql()
    const existingSql = new Map(currentSavedSql.map((item) => [`${item.dataSourceId}\u0000${item.sql.trim()}`, item]))
    const existingSqlNames = new Map<string, Set<string>>()
    for (const item of currentSavedSql) {
      const names = existingSqlNames.get(item.dataSourceId) ?? new Set<string>()
      names.add(item.name.toLocaleLowerCase())
      existingSqlNames.set(item.dataSourceId, names)
    }
    let savedSqlImported = 0
    let savedSqlSkipped = 0
    for (const item of savedSql) {
      const dataSourceId = item.dataSourceName === null
        ? this.getActiveDataSourceId() ?? this.listDataSources()[0]?.id
        : sourceIds.get(item.dataSourceName.toLocaleLowerCase())
      if (!dataSourceId) {
        savedSqlSkipped += 1
        continue
      }
      const key = `${dataSourceId}\u0000${item.sql.trim()}`
      const existing = existingSql.get(key)
      if (existing) {
        this.db.prepare('UPDATE saved_sql SET name = ?, sql = ?, updated_at = ? WHERE id = ?').run(
          item.name.trim(), item.sql.trim(), new Date().toISOString(), existing.id,
        )
        existingSql.set(key, { ...existing, name: item.name.trim(), sql: item.sql.trim() })
        savedSqlImported += 1
        continue
      }
      const sourceSqlNames = existingSqlNames.get(dataSourceId) ?? new Set<string>()
      existingSqlNames.set(dataSourceId, sourceSqlNames)
      const name = uniqueImportedName(item.name, sourceSqlNames)
      const imported = this.saveSql({ dataSourceId, name, sql: item.sql })
      existingSql.set(key, imported)
      savedSqlImported += 1
    }

    // Import favorite query runs — deduplicate by (dataSourceId + sql + createdAt)
    const existingRunKeys = new Set(
      (this.db.prepare('SELECT data_source_id, sql, created_at FROM query_runs WHERE is_favorite = 1').all() as unknown as Array<{ data_source_id: string; sql: string; created_at: string }>)
        .map((r) => `${r.data_source_id}\u0000${r.sql.trim()}\u0000${r.created_at}`),
    )
    let favoriteRunsImported = 0
    let favoriteRunsSkipped = 0
    for (const run of favoriteRuns) {
      const dataSourceId = sourceIds.get(run.dataSourceName.toLocaleLowerCase())
      if (!dataSourceId) { favoriteRunsSkipped += 1; continue }
      const key = `${dataSourceId}\u0000${run.sql.trim()}\u0000${run.createdAt}`
      if (existingRunKeys.has(key)) { favoriteRunsSkipped += 1; continue }
      const id = randomUUID()
      this.db.prepare(`
        INSERT INTO query_runs (
          id, data_source_id, data_source_name, question, answer, sql,
          table_json, chart_json, status, error, duration_ms, mode, model, is_favorite, is_pinned, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, 0, ?)
      `).run(
        id, dataSourceId, this.getDataSource(dataSourceId)?.name ?? run.dataSourceName, run.question, run.answer, run.sql,
        run.chart ? JSON.stringify(run.chart) : null,
        run.status, run.error, run.durationMs, run.mode, run.model ?? null, run.createdAt,
      )
      existingRunKeys.add(key)
      favoriteRunsImported += 1
    }
    return { dataSourcesImported, dataSourcesSkipped: 0, savedSqlImported, savedSqlSkipped, favoriteRunsImported, favoriteRunsSkipped }
  }

  bootstrap(): Omit<BootstrapData, 'appVersion'> {
    return {
      dataSources: this.listDataSources(),
      activeDataSourceId: this.getActiveDataSourceId(),
      queryRuns: this.listQueryRuns(),
      savedSql: this.listSavedSql(),
      modelChannels: this.listModelChannels(),
      scheduledTasks: this.listScheduledTasks(),
      dashboards: this.listDashboards(),
    }
  }

  close() {
    this.db.close()
  }

  private mapModelChannel(row: ModelChannelRow): ModelChannel {
    let availableModels: string[] = []
    try {
      const parsed = JSON.parse(row.model_list_json) as unknown
      if (Array.isArray(parsed)) availableModels = parsed.filter((item): item is string => typeof item === 'string')
    } catch {
      // Treat damaged optional model-list metadata as empty.
    }
    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      model: row.model,
      availableModels,
      hasApiKey: this.canDecrypt(row.encrypted_api_key),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapScheduledTask(row: ScheduledTaskRow): ScheduledTask {
    return {
      id: row.id,
      name: row.name,
      dataSourceId: row.data_source_id,
      dataSourceName: this.getDataSource(row.data_source_id)?.name ?? '未知数据源',
      sql: row.sql,
      scheduleKind: row.schedule_kind,
      intervalMinutes: row.interval_minutes,
      timeOfDay: row.time_of_day,
      dayOfWeek: row.day_of_week,
      enabled: Boolean(row.enabled),
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      lastError: row.last_error,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapDashboard(row: DashboardRow): Dashboard {
    let cards: DashboardCard[] = []
    try {
      const parsed = JSON.parse(row.cards_json) as unknown
      if (Array.isArray(parsed)) cards = parsed.filter((card): card is DashboardCard => (
        typeof card === 'object' && card !== null
        && typeof (card as DashboardCard).id === 'string'
        && typeof (card as DashboardCard).queryRunId === 'string'
        && typeof (card as DashboardCard).title === 'string'
        && ['chart', 'table', 'metric'].includes((card as DashboardCard).view)
        && ['half', 'full'].includes((card as DashboardCard).width)
      ))
    } catch {
      // Treat damaged optional dashboard metadata as an empty dashboard.
    }
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      cards,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapDataSource(row: DataSourceRow): DataSource {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      host: row.host,
      port: row.port,
      database: row.database_name,
      username: row.username,
      sslMode: row.ssl_mode,
      filePath: row.file_path,
      status: row.status,
      lastTestedAt: row.last_tested_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      hasPassword: this.canDecrypt(row.encrypted_password),
    }
  }

  private mapQueryRun(row: QueryRunRow): QueryRun {
    return {
      id: row.id,
      dataSourceId: row.data_source_id,
      dataSourceName: row.data_source_name,
      question: row.question,
      answer: row.answer,
      sql: row.sql,
      table: row.table_json ? (JSON.parse(row.table_json) as QueryTable) : null,
      chart: row.chart_json ? (JSON.parse(row.chart_json) as ChartSpec) : null,
      status: row.status,
      error: row.error,
      durationMs: row.duration_ms,
      mode: row.mode ?? 'smart',
      model: row.model ?? null,
      processLogs: parseProcessLogs(row.process_json),
      isFavorite: Boolean(row.is_favorite),
      isPinned: Boolean(row.is_pinned),
      createdAt: row.created_at,
    }
  }

  private mapSavedSql(row: SavedSqlRow): SavedSql {
    return {
      id: row.id,
      dataSourceId: row.data_source_id,
      name: row.name,
      sql: row.sql,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

}
