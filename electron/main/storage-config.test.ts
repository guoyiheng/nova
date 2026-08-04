import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { Storage } from './storage.js'

describe('portable configuration', () => {
  let sourceStorage: Storage
  let targetStorage: Storage

  beforeEach(() => {
    sourceStorage = new Storage(':memory:')
    targetStorage = new Storage(':memory:')
  })

  afterEach(() => {
    sourceStorage.close()
    targetStorage.close()
  })

  it('uses default names when data source and model channel names are blank', () => {
    const source = sourceStorage.saveDataSource({ name: '   ', type: 'postgres' })
    const channel = sourceStorage.saveModelChannel({
      name: '',
      baseUrl: 'https://models.example.com/v1',
      model: 'model-a',
    })

    expect(source.name).toBe('默认数据源')
    expect(channel.name).toBe('默认提供商')
  })

  it('persists scheduled SQL tasks and advances their next run after completion', () => {
    const source = sourceStorage.saveDataSource({ name: 'Analytics', type: 'postgres' })
    const task = sourceStorage.saveScheduledTask({
      name: 'Hourly report',
      dataSourceId: source.id,
      sql: 'SELECT 1',
      scheduleKind: 'interval',
      intervalMinutes: 60,
      enabled: true,
    })

    expect(task.dataSourceName).toBe('Analytics')
    expect(task.nextRunAt).not.toBeNull()
    const completed = sourceStorage.completeScheduledTask(task.id, 'success', null, new Date('2026-08-04T02:00:00.000Z'))
    expect(completed.lastRunAt).toBe('2026-08-04T02:00:00.000Z')
    expect(completed.nextRunAt).toBe('2026-08-04T03:00:00.000Z')
    expect(sourceStorage.bootstrap().scheduledTasks).toHaveLength(1)

    sourceStorage.deleteScheduledTask(task.id)
    expect(sourceStorage.listScheduledTasks()).toEqual([])
  })

  it('exports data sources, model channels and saved SQL with credentials', () => {
    const source = sourceStorage.saveDataSource({
      name: 'Analytics',
      type: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'analytics',
      username: 'reader',
      password: 'database-secret',
    })
    sourceStorage.saveModelChannel({
      name: 'OpenAI',
      baseUrl: 'https://models.example.com/v1',
      model: 'model-a',
      availableModels: ['model-a', 'model-b'],
      apiKey: 'model-secret',
    })
    sourceStorage.saveSql({ dataSourceId: source.id, name: 'Orders', sql: 'SELECT * FROM orders' })

    const exported = sourceStorage.exportableConfig()

    expect(exported.version).toBe(6)
    expect(exported.dataSources).toHaveLength(1)
    expect(exported.dataSources[0]?.password).toBe('database-secret')
    expect(exported.modelChannels).toEqual([{
      name: 'OpenAI',
      baseUrl: 'https://models.example.com/v1',
      model: 'model-a',
      availableModels: ['model-a', 'model-b'],
      apiKey: 'model-secret',
    }])
    expect(exported.savedSql).toEqual([{ dataSourceName: 'Analytics', name: 'Orders', sql: 'SELECT * FROM orders' }])
    expect(JSON.stringify(exported)).toContain('database-secret')
    expect(JSON.stringify(exported)).toContain('model-secret')
  })

  it('imports exported credentials into local encrypted storage', () => {
    const source = sourceStorage.saveDataSource({
      name: 'Analytics',
      type: 'postgres',
      password: 'database-secret',
    })
    sourceStorage.saveModelChannel({
      name: 'OpenAI',
      baseUrl: 'https://models.example.com/v1',
      model: 'model-a',
      apiKey: 'model-secret',
    })

    const exported = sourceStorage.exportableConfig()
    targetStorage.importConfiguration(exported.dataSources, exported.savedSql, exported.favoriteRuns)
    targetStorage.importModelChannels(exported.modelChannels)

    const importedSource = targetStorage.listDataSources().find((item) => item.name === source.name)
    expect(importedSource?.hasPassword).toBe(true)
    expect(targetStorage.getDataSourceSecret(importedSource!.id)).toBe('database-secret')
    const importedChannel = targetStorage.listModelChannels()[0]!
    expect(importedChannel.name).toBe('OpenAI')
    expect(targetStorage.getModelChannelApiKey(importedChannel.id)).toBe('model-secret')
  })

  it('encrypts credentials locally and reopens them without system storage', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-local-credentials-'))
    const databasePath = join(directory, 'nova.sqlite')
    const storage = new Storage(databasePath)
    const source = storage.saveDataSource({ name: 'Analytics', type: 'postgres', password: 'database-secret' })
    const channel = storage.saveModelChannel({
      name: 'Local model',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'local-model',
      apiKey: 'model-secret',
    })
    storage.close()

    const database = new DatabaseSync(databasePath)
    const password = database.prepare('SELECT encrypted_password AS value FROM data_sources WHERE id = ?').get(source.id) as { value: string }
    const apiKey = database.prepare('SELECT encrypted_api_key AS value FROM model_channels WHERE id = ?').get(channel.id) as { value: string }
    database.close()
    expect(password.value).toMatch(/^local:v1:/)
    expect(apiKey.value).toMatch(/^local:v1:/)
    expect(password.value).not.toContain('database-secret')
    expect(apiKey.value).not.toContain('model-secret')

    const reopened = new Storage(databasePath)
    try {
      expect(reopened.getDataSourceSecret(source.id)).toBe('database-secret')
      expect(reopened.getModelChannelApiKey(channel.id)).toBe('model-secret')
    } finally {
      reopened.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does not access legacy system-storage credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-denied-credentials-'))
    const databasePath = join(directory, 'nova.sqlite')
    const initial = new Storage(databasePath)
    const source = initial.saveDataSource({ name: 'Analytics', type: 'postgres' })
    initial.close()

    const database = new DatabaseSync(databasePath)
    database.prepare('UPDATE data_sources SET encrypted_password = ? WHERE id = ?')
      .run(Buffer.from('legacy-secret').toString('base64'), source.id)
    database.close()

    const reopened = new Storage(databasePath)
    try {
      expect(reopened.getDataSource(source.id)?.hasPassword).toBe(false)
      expect(() => reopened.getDataSourceSecret(source.id)).toThrow('请重新填写并保存')
    } finally {
      reopened.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('merges duplicate imports and rebinds saved SQL to the existing data source', () => {
    const exported = {
      dataSources: [{ name: 'Analytics', type: 'postgres' as const, host: 'localhost', port: 5432, database: 'analytics', username: 'reader' }],
      savedSql: [{ dataSourceName: 'Analytics', name: 'Orders', sql: 'SELECT * FROM orders' }],
    }

    expect(targetStorage.importConfiguration(exported.dataSources, exported.savedSql, [])).toEqual({
      dataSourcesImported: 1,
      dataSourcesSkipped: 0,
      savedSqlImported: 1,
      savedSqlSkipped: 0,
      favoriteRunsImported: 0,
      favoriteRunsSkipped: 0,
    })
    expect(targetStorage.listSavedSql()[0]?.dataSourceId).toBe(targetStorage.listDataSources()[0]?.id)

    exported.dataSources[0]!.host = 'imported.example'
    expect(targetStorage.importConfiguration(exported.dataSources, exported.savedSql, [])).toEqual({
      dataSourcesImported: 1,
      dataSourcesSkipped: 0,
      savedSqlImported: 1,
      savedSqlSkipped: 0,
      favoriteRunsImported: 0,
      favoriteRunsSkipped: 0,
    })
    expect(targetStorage.listDataSources()).toHaveLength(1)
    expect(targetStorage.listDataSources()[0]?.host).toBe('imported.example')
    expect(targetStorage.listSavedSql()).toHaveLength(1)
    expect(targetStorage.listSavedSql()[0]?.dataSourceId).toBe(targetStorage.listDataSources()[0]?.id)
  })

  it('binds legacy global saved SQL imports to the active data source', () => {
    const source = targetStorage.saveDataSource({ name: 'Analytics', type: 'postgres' })
    const savedSql = [{ dataSourceName: null, name: 'Health check', sql: 'SELECT 1' }]

    expect(targetStorage.importConfiguration([], savedSql, []).savedSqlImported).toBe(1)
    expect(targetStorage.listSavedSql()[0]?.dataSourceId).toBe(source.id)
    expect(targetStorage.importConfiguration([], savedSql, [])).toMatchObject({ savedSqlImported: 1, savedSqlSkipped: 0 })
  })

  it('scopes duplicate saved SQL names and content to their data source', () => {
    const analytics = targetStorage.saveDataSource({ name: 'Analytics', type: 'postgres' })
    const archive = targetStorage.saveDataSource({ name: 'Archive', type: 'postgres' })
    targetStorage.saveSql({ dataSourceId: analytics.id, name: 'Report', sql: 'SELECT 1' })

    expect(targetStorage.importConfiguration([], [
      { dataSourceName: 'Analytics', name: 'report', sql: 'SELECT 2' },
      { dataSourceName: 'Analytics', name: 'Report', sql: 'SELECT 3' },
      { dataSourceName: 'Analytics', name: 'Unused duplicate name', sql: 'SELECT 2' },
      { dataSourceName: 'Archive', name: 'Report', sql: 'SELECT 1' },
    ], [])).toMatchObject({ savedSqlImported: 4, savedSqlSkipped: 0 })
    const analyticsNames = targetStorage.listSavedSql()
      .filter((item) => item.dataSourceId === analytics.id)
      .map((item) => item.name)
    const archiveNames = targetStorage.listSavedSql()
      .filter((item) => item.dataSourceId === archive.id)
      .map((item) => item.name)
    expect(analyticsNames).toEqual(expect.arrayContaining(['Report', 'Unused duplicate name', 'Report（2）']))
    expect(archiveNames).toEqual(['Report'])
  })

  it('migrates legacy global saved SQL to the active data source', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-storage-'))
    const databasePath = join(directory, 'nova.sqlite')
    const initialStorage = new Storage(databasePath)
    const source = initialStorage.saveDataSource({ name: 'Analytics', type: 'postgres' })
    initialStorage.close()

    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE saved_sql;
      CREATE TABLE saved_sql (
        id TEXT PRIMARY KEY,
        data_source_id TEXT,
        name TEXT NOT NULL,
        sql TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
      );
    `)
    legacyDatabase.prepare(
      'INSERT INTO saved_sql VALUES (?, NULL, ?, ?, ?, ?)',
    ).run('legacy-sql', 'Global', 'SELECT 1', new Date().toISOString(), new Date().toISOString())
    legacyDatabase.close()

    const migratedStorage = new Storage(databasePath)
    try {
      expect(migratedStorage.listSavedSql()[0]?.dataSourceId).toBe(source.id)
      const migratedDatabase = new DatabaseSync(databasePath)
      const sourceColumn = (migratedDatabase.prepare('PRAGMA table_info(saved_sql)').all() as unknown as Array<{ name: string; notnull: number }>)
        .find((column) => column.name === 'data_source_id')
      migratedDatabase.close()
      expect(sourceColumn?.notnull).toBe(1)
    } finally {
      migratedStorage.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('removes legacy dashboard storage without deleting query history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-dashboard-migration-'))
    const databasePath = join(directory, 'nova.sqlite')
    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
      CREATE TABLE dashboards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data_source_id TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE query_runs (
        id TEXT PRIMARY KEY,
        dashboard_id TEXT,
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
        model TEXT,
        process_json TEXT,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      INSERT INTO dashboards VALUES ('dashboard-1', 'Legacy', NULL, 1, '2026-01-01', '2026-01-01');
      INSERT INTO query_runs VALUES (
        'run-1', 'dashboard-1', 'source-1', 'Analytics', 'Count orders', '42',
        'SELECT COUNT(*) FROM orders', NULL, NULL, 'success', NULL, 10, 'smart', NULL, NULL, 1, 0, '2026-01-01'
      );
    `)
    legacyDatabase.close()

    const migratedStorage = new Storage(databasePath)
    try {
      expect(migratedStorage.getQueryRun('run-1')).toMatchObject({ question: 'Count orders', isFavorite: true })
      migratedStorage.close()
      const migratedDatabase = new DatabaseSync(databasePath)
      expect(migratedDatabase.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dashboards'").get()).toBeUndefined()
      expect(migratedDatabase.prepare('PRAGMA table_info(query_runs)').all()).not.toContainEqual(expect.objectContaining({ name: 'dashboard_id' }))
      migratedDatabase.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('migrates legacy singleton model settings into a default channel', () => {
    const directory = mkdtempSync(join(tmpdir(), 'nova-model-migration-'))
    const databasePath = join(directory, 'nova.sqlite')
    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const insert = legacyDatabase.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    insert.run('modelBaseUrl', 'https://legacy.example.com/v1')
    insert.run('modelName', 'legacy-model')
    insert.run('modelListBaseUrl', 'https://legacy.example.com/v1')
    insert.run('modelList', JSON.stringify(['legacy-model', 'legacy-fast']))
    insert.run('modelApiKey', Buffer.from('legacy-secret').toString('base64'))
    legacyDatabase.close()

    const migratedStorage = new Storage(databasePath)
    try {
      const channel = migratedStorage.listModelChannels()[0]!
      expect(channel).toMatchObject({
        name: '默认提供商',
        baseUrl: 'https://legacy.example.com/v1',
        model: 'legacy-model',
        availableModels: ['legacy-model', 'legacy-fast'],
        hasApiKey: false,
      })
      expect(() => migratedStorage.getModelChannelApiKey(channel.id)).toThrow('请重新填写并保存')
    } finally {
      migratedStorage.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('completes initial setup with a data source and model channel together', () => {
    const result = targetStorage.completeInitialSetup(
      {
        name: 'Analytics',
        type: 'postgres',
        host: 'db.internal',
        port: 5432,
        database: 'analytics',
        username: 'reader',
        password: 'database-secret',
      },
      {
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5-mini',
        availableModels: ['gpt-5-mini', 'gpt-5'],
        apiKey: 'model-secret',
      },
    )

    expect(targetStorage.getActiveDataSourceId()).toBe(result.dataSource.id)
    expect(targetStorage.getDataSourceSecret(result.dataSource.id)).toBe('database-secret')
    expect(targetStorage.getModelChannelApiKey(result.modelChannel.id)).toBe('model-secret')
    expect(targetStorage.bootstrap().modelChannels).toEqual([result.modelChannel])
  })

  it('keeps provider credentials isolated and merges duplicate provider names on import', () => {
    const first = targetStorage.saveModelChannel({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
      apiKey: 'openai-secret',
    })
    const second = targetStorage.saveModelChannel({
      name: 'Internal',
      baseUrl: 'https://models.internal/v1',
      model: 'company-model',
      apiKey: 'internal-secret',
    })

    expect(targetStorage.getModelChannelApiKey(first.id)).toBe('openai-secret')
    expect(targetStorage.getModelChannelApiKey(second.id)).toBe('internal-secret')
    expect(targetStorage.importModelChannels([
      { name: 'openai', baseUrl: 'https://duplicate.example/v1', model: 'duplicate', apiKey: 'duplicate-secret' },
      { name: 'OpenAI', baseUrl: 'https://second.example/v1', model: 'second', apiKey: 'second-secret' },
      { name: 'Azure', baseUrl: 'https://azure.example/v1', model: 'gpt-4.1', apiKey: 'azure-secret' },
    ])).toEqual({ imported: 3, skipped: 0 })
    expect(targetStorage.listModelChannels().map((channel) => channel.name)).toEqual(['OpenAI', 'Internal', 'Azure'])
    const merged = targetStorage.listModelChannels().find((channel) => channel.name === 'OpenAI')!
    expect(merged.baseUrl).toBe('https://second.example/v1')
    expect(targetStorage.getModelChannelApiKey(merged.id)).toBe('second-secret')
  })

  it('keeps model lists scoped to their channel endpoint', () => {
    const channel = targetStorage.saveModelChannel({
      name: 'OpenAI',
      baseUrl: 'https://models.example.com/v1',
      model: 'model-a',
      availableModels: ['model-a', 'model-b', 'model-a'],
    })
    expect(targetStorage.getModelChannel(channel.id)?.availableModels).toEqual(['model-a', 'model-b'])

    targetStorage.saveModelChannel({
      id: channel.id,
      name: channel.name,
      baseUrl: 'https://other.example.com/v1',
      model: 'other-model',
    })
    expect(targetStorage.getModelChannel(channel.id)?.availableModels).toEqual([])
  })

  it('persists query process logs with the result card', () => {
    const source = targetStorage.saveDataSource({ name: 'Analytics', type: 'postgres' })
    const run = targetStorage.saveQueryRun({
      dataSourceId: source.id,
      dataSourceName: source.name,
      question: 'Count orders',
      answer: '42',
      sql: 'SELECT COUNT(*) FROM orders',
      table: { columns: ['count'], rows: [{ count: 42 }], truncated: false },
      chart: null,
      status: 'success',
      error: null,
      durationMs: 18,
      mode: 'smart',
      model: 'OpenAI · gpt-5-mini',
      processLogs: [{
        id: 'querying-1',
        stage: 'querying',
        title: '执行 SQL',
        detail: 'SELECT COUNT(*) FROM orders',
        queryResult: { columns: ['count'], rows: [{ count: 42 }], truncated: false },
        status: 'success',
        elapsedMs: 12,
      }],
    })

    expect(targetStorage.getQueryRun(run.id)?.processLogs).toEqual(run.processLogs)
    expect(targetStorage.bootstrap().queryRuns[0]?.processLogs).toEqual(run.processLogs)
  })

  it('exports and imports favorite query runs and skips duplicates', () => {
    const source = sourceStorage.saveDataSource({
      name: 'Analytics',
      type: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'analytics',
      username: 'reader',
    })
    const run = sourceStorage.saveQueryRun({
      dataSourceId: source.id,
      dataSourceName: source.name,
      question: 'Count orders',
      answer: '42',
      sql: 'SELECT COUNT(*) FROM orders',
      table: { columns: ['count'], rows: [{ count: 42 }], truncated: false },
      chart: null,
      status: 'success',
      error: null,
      durationMs: 15,
      mode: 'smart',
    })
    sourceStorage.updateQueryRun(run.id, { isFavorite: true })

    const exported = sourceStorage.exportableConfig()
    expect(exported.favoriteRuns).toHaveLength(1)
    expect(exported.favoriteRuns[0]?.question).toBe('Count orders')
    // table_json is excluded from export to keep file size manageable
    expect(exported.favoriteRuns[0]).not.toHaveProperty('table')
    expect(JSON.stringify(exported)).not.toContain('favoriteRuns')

    // Import into target that has a matching data source.
    targetStorage.saveDataSource({ name: 'Analytics', type: 'postgres' })
    const summary = targetStorage.importConfiguration([], exported.savedSql, exported.favoriteRuns)
    expect(summary.favoriteRunsImported).toBe(1)
    expect(summary.favoriteRunsSkipped).toBe(0)
    const importedRuns = targetStorage.listQueryRuns().filter((r) => r.isFavorite)
    expect(importedRuns).toHaveLength(1)
    expect(importedRuns[0]?.question).toBe('Count orders')

    // Re-importing should skip the duplicate
    const summary2 = targetStorage.importConfiguration([], exported.savedSql, exported.favoriteRuns)
    expect(summary2.favoriteRunsImported).toBe(0)
    expect(summary2.favoriteRunsSkipped).toBe(1)
  })

  it('skips favorite runs when data source is not found', () => {
    const favoriteRuns = [{
      dataSourceName: 'NonExistent',
      question: 'Count',
      answer: '1',
      sql: 'SELECT 1',
      chart: null,
      status: 'success' as const,
      error: null,
      durationMs: 5,
      mode: 'smart' as const,
      model: null,
      createdAt: new Date().toISOString(),
    }]
    const summary = targetStorage.importConfiguration([], [], favoriteRuns)
    expect(summary.favoriteRunsImported).toBe(0)
    expect(summary.favoriteRunsSkipped).toBe(1)
  })
})
