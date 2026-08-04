import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { describeConnection, describeProgressError, describeQueryResult, describeSchema, recommendFunnels, runAgent } from './agent.js'
import { buildDsn, DbhubSession, executeSql, loadSchemaSnapshot } from './dbhub.js'
import { changesSchemaSql } from './dbhub-utils.js'
import { Storage, uniqueImportedName } from './storage.js'
import { ensureDemoDatabase, resetDemoDatabase } from './demo-database.js'
import { fetchModelIds } from './models.js'
import { checkAppUpdate, downloadAppUpdate, openDownloadedUpdate } from './updater.js'
import { RendererUpdater } from './renderer-updater.js'
import { extractSchemaCacheStructure, inspectSchemaCache, isSchemaCacheStale, missingSchemaCacheInfo, resolveSchemaSnapshot } from './schema-cache.js'
import { TaskScheduler } from './scheduler.js'
import type { AgentProgressEvent, AgentStage, DataSource, DataSourceInput, QueryTable, ScheduledTask } from '../shared/types.js'

let mainWindow: BrowserWindow | null = null
let storage: Storage
let rendererUpdater: RendererUpdater
let taskScheduler: TaskScheduler
let rendererReadyTimer: ReturnType<typeof setTimeout> | null = null

const RENDERER_URL = 'nova://app/index.html'
const rendererConfigSchema = z.object({
  schemaVersion: z.literal(1),
  shellApiVersion: z.number().int().positive(),
  publicKey: z.string().min(40),
})

protocol.registerSchemesAsPrivileged([{
  scheme: 'nova',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

function upsertProgress(logs: AgentProgressEvent[], progress: AgentProgressEvent) {
  const index = logs.findIndex((item) => item.id === progress.id)
  if (index === -1) logs.push(progress)
  else logs[index] = progress
}

function createIpcProgress(sender: { send: (channel: string, payload: AgentProgressEvent) => void }, logs: AgentProgressEvent[], queryId: string) {
  let sequence = 0
  return (stage: AgentStage, title: string, detail: string) => {
    const id = `${stage}-${sequence += 1}`
    const startedAt = Date.now()
    const send = (progress: AgentProgressEvent) => {
      upsertProgress(logs, progress)
      sender.send('nova:agent:progress', progress)
    }
    send({ id, queryId, stage, title, detail, status: 'running', elapsedMs: 0 })
    return {
      success(nextDetail = detail, queryResult?: QueryTable) {
        send({ id, queryId, stage, title, detail: nextDetail, queryResult, status: 'success', elapsedMs: Date.now() - startedAt })
      },
      error(errorDetail: string) {
        send({ id, queryId, stage, title, detail: describeProgressError(detail, errorDetail), status: 'error', elapsedMs: Date.now() - startedAt })
      },
    }
  }
}

const dataSourceSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().max(80),
  type: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver', 'sqlite', 'demo']),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  database: z.string().max(255).optional(),
  username: z.string().max(255).optional(),
  password: z.string().max(4096).optional(),
  sslMode: z.string().max(32).optional(),
  filePath: z.string().max(4096).optional(),
})

const modelListSchema = z.object({
  channelId: z.string().uuid().optional(),
  baseUrl: z.string().url().max(2048),
  apiKey: z.string().max(4096).optional(),
})

const modelChannelSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().max(80),
  baseUrl: z.string().url().max(2048),
  model: z.string().trim().min(1).max(200),
  availableModels: z.array(z.string().trim().min(1).max(200)).max(1000).optional(),
  apiKey: z.string().max(4096).optional(),
})

const askSchema = z.object({
  queryId: z.string().uuid(),
  question: z.string().trim().min(2).max(4000),
  displayQuestion: z.string().trim().min(1).max(4000).optional(),
  dataSourceId: z.string().uuid(),
  modelChannelId: z.string().uuid(),
  model: z.string().trim().min(1).max(200),
})

const funnelRecommendationSchema = z.object({
  dataSourceId: z.string().uuid(),
  modelChannelId: z.string().uuid(),
  model: z.string().trim().min(1).max(200),
  focus: z.string().trim().max(500).optional(),
})

const chartSpecSchema = z.object({
  type: z.enum(['bar', 'line', 'pie', 'radar', 'scatter', 'bubble', 'heatmap', 'funnel', 'none']),
  xKey: z.string().max(200).optional(),
  yKey: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
})

const sqlQuerySchema = z.object({
  queryId: z.string().uuid(),
  sql: z.string().trim().min(1).max(200_000),
  dataSourceId: z.string().uuid(),
  question: z.string().trim().min(1).max(4000).optional(),
  chart: chartSpecSchema.nullable().optional(),
})

const savedSqlSchema = z.object({
  dataSourceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  sql: z.string().trim().min(1).max(200_000),
})

const batchImportSqlSchema = z.object({
  dataSourceId: z.string().uuid(),
  content: z.string().min(1).max(2_000_000),
})

const scheduledTaskSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  question: z.string().trim().min(2).max(4000),
  dataSourceId: z.string().uuid(),
  sql: z.string().trim().min(1).max(200_000),
  scheduleKind: z.enum(['interval', 'daily', 'weekly']),
  intervalMinutes: z.number().int().min(15).max(10_080).nullable().optional(),
  timeOfDay: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  enabled: z.boolean(),
})

const dashboardCardSchema = z.object({
  id: z.string().min(1).max(100),
  queryRunId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  view: z.enum(['chart', 'table', 'metric']),
  chartType: z.enum(['bar', 'line', 'pie', 'radar', 'scatter', 'bubble', 'heatmap', 'funnel', 'none']),
  x: z.number().int().min(0).max(31),
  y: z.number().int().min(0).max(99),
  width: z.number().int().min(1).max(32),
  height: z.number().int().min(1).max(100),
})

const dashboardSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(240).optional(),
  columns: z.number().int().min(2).max(8),
  rows: z.number().int().min(2).max(100).default(4),
  cards: z.array(dashboardCardSchema).max(24),
})

const dashboardExportSchema = z.object({
  name: z.string().trim().min(1).max(80),
  format: z.enum(['html', 'png']),
  data: z.string().max(50_000_000),
})

const portableSavedSqlSchema = z.object({
  dataSourceName: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  sql: z.string().trim().min(1).max(200_000),
})

const portableGlobalSavedSqlSchema = portableSavedSqlSchema.extend({
  dataSourceName: z.string().trim().min(1).max(80).nullable(),
})

const portableModelSchema = z.object({
  baseUrl: z.string().url().max(2048),
  model: z.string().trim().min(1).max(200),
})

const portableModelChannelSchema = modelChannelSchema.omit({ id: true }).extend({
  apiKey: z.string().max(4096).optional(),
})

function demoDatabasePath() {
  return path.join(app.getPath('userData'), 'nova-demo.sqlite')
}

function prepareDataSourceInput(input: DataSourceInput): DataSourceInput {
  if (input.type !== 'demo') return input
  return {
    ...input,
    name: input.name.trim() || 'Nova 示例商店',
    host: '',
    port: null,
    database: 'nova_demo',
    username: '',
    password: '',
    sslMode: 'disable',
    filePath: demoDatabasePath(),
  }
}

function executionSummary(table: QueryTable) {
  return table.affectedRows !== undefined
    ? `影响 ${table.affectedRows} 行`
    : `返回 ${table.rows.length}${table.truncated ? '+' : ''} 行`
}

async function rebuildSchemaCacheForSource(source: DataSource) {
  const session = new DbhubSession()
  try {
    await session.connect(buildDsn(source, storage.getDataSourceSecret(source.id)))
    const schemaJson = await loadSchemaSnapshot(session)
    storage.saveSchemaCache(source.id, schemaJson)
    const cached = storage.getSchemaCacheRecord(source.id)!
    return inspectSchemaCache(source.id, cached.schemaJson, cached.refreshedAt)
  } finally {
    await session.close()
  }
}

async function executeScheduledTask(task: ScheduledTask): Promise<ScheduledTask> {
  const source = storage.getDataSource(task.dataSourceId)
  const startedAt = Date.now()
  const session = new DbhubSession()
  try {
    if (!source) throw new Error('任务关联的数据源不存在。')
    const tools = await session.connect(buildDsn(source, storage.getDataSourceSecret(source.id)))
    if (!tools.tools.some((tool) => tool.name === 'execute_sql')) throw new Error('DBHub 未提供 SQL 执行工具。')
    const table = await executeSql(session, task.sql)
    if (changesSchemaSql(task.sql)) storage.clearSchemaCache(source.id)
    storage.saveQueryRun({
      dataSourceId: source.id,
      dataSourceName: source.name,
      question: task.question,
      answer: `定时任务执行完成，${executionSummary(table)}。`,
      sql: task.sql,
      table,
      chart: null,
      status: 'success',
      error: null,
      durationMs: Date.now() - startedAt,
      mode: 'sql',
    })
    return storage.completeScheduledTask(task.id, 'success', null)
  } catch (error) {
    const message = error instanceof Error ? error.message : '定时任务执行失败。'
    storage.saveQueryRun({
      dataSourceId: task.dataSourceId,
      dataSourceName: source?.name ?? task.dataSourceName,
      question: task.question,
      answer: '',
      sql: task.sql,
      table: null,
      chart: null,
      status: 'error',
      error: message,
      durationMs: Date.now() - startedAt,
      mode: 'sql',
    })
    return storage.completeScheduledTask(task.id, 'error', message)
  } finally {
    await session.close()
  }
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: '#f1f2ed',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('did-finish-load', () => {
    if (!rendererUpdater.hasPendingUpdate()) return
    if (rendererReadyTimer) clearTimeout(rendererReadyTimer)
    rendererReadyTimer = setTimeout(() => {
      void rollbackRendererUpdate()
    }, 15_000)
  })
  mainWindow.webContents.on('did-fail-load', (_event, _errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && rendererUpdater.hasPendingUpdate()) void rollbackRendererUpdate()
  })

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else if (!app.isPackaged) {
    void mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    void mainWindow.loadURL(RENDERER_URL)
  }
}

async function rollbackRendererUpdate() {
  if (rendererReadyTimer) clearTimeout(rendererReadyTimer)
  rendererReadyTimer = null
  await rendererUpdater.rollbackPendingUpdate()
  if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(RENDERER_URL)
}

async function rendererProtocolResponse(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url)
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 })
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    if (relativePath.includes('\\') || relativePath.split('/').includes('..')) {
      return new Response('Forbidden', { status: 403 })
    }
    const root = path.resolve(rendererUpdater.getRendererDirectory())
    const filePath = path.resolve(root, relativePath)
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function registerIpc() {
  ipcMain.handle('nova:bootstrap', () => ({ ...storage.bootstrap(), appVersion: app.getVersion() }))

  ipcMain.handle('nova:data-source:save', (_event, payload) => {
    const input = prepareDataSourceInput(dataSourceSchema.parse(payload))
    const existingDemo = input.type === 'demo' && !input.id
      ? storage.listDataSources().find((source) => source.type === 'demo')
      : undefined
    if (existingDemo) {
      storage.setActiveDataSource(existingDemo.id)
      return existingDemo
    }
    return storage.saveDataSource(input)
  })

  ipcMain.handle('nova:data-source:delete', (_event, id: string) => {
    const dataSourceId = z.string().uuid().parse(id)
    if (storage.getDataSource(dataSourceId)?.type === 'demo') throw new Error('内置示例数据源不能删除，可以恢复其初始数据。')
    storage.deleteDataSource(dataSourceId)
  })

  ipcMain.handle('nova:data-source:activate', (_event, id: string) => {
    const parsedId = z.string().uuid().parse(id)
    if (!storage.getDataSource(parsedId)) throw new Error('数据源不存在。')
    storage.setActiveDataSource(parsedId)
  })

  ipcMain.handle('nova:schema-cache:get', (_event, id: string) => {
    const dataSourceId = z.string().uuid().parse(id)
    if (!storage.getDataSource(dataSourceId)) throw new Error('数据源不存在。')
    const cached = storage.getSchemaCacheRecord(dataSourceId)
    return cached
      ? inspectSchemaCache(dataSourceId, cached.schemaJson, cached.refreshedAt)
      : missingSchemaCacheInfo(dataSourceId)
  })

  ipcMain.handle('nova:schema-cache:structure', (_event, id: string) => {
    const dataSourceId = z.string().uuid().parse(id)
    if (!storage.getDataSource(dataSourceId)) throw new Error('数据源不存在。')
    const cached = storage.getSchemaCacheRecord(dataSourceId)
    return extractSchemaCacheStructure(dataSourceId, cached?.schemaJson ?? '')
  })

  ipcMain.handle('nova:schema-cache:rebuild', async (_event, id: string) => {
    const dataSourceId = z.string().uuid().parse(id)
    const source = storage.getDataSource(dataSourceId)
    if (!source) throw new Error('数据源不存在。')
    return rebuildSchemaCacheForSource(source)
  })

  ipcMain.handle('nova:demo:reset', async (_event, id: string) => {
    const dataSourceId = z.string().uuid().parse(id)
    const source = storage.getDataSource(dataSourceId)
    if (!source || source.type !== 'demo') throw new Error('演示数据源不存在。')
    resetDemoDatabase(demoDatabasePath())
    storage.clearSchemaCache(source.id)
    try {
      await rebuildSchemaCacheForSource(source)
      storage.updateDataSourceStatus(source.id, 'connected')
    } catch (error) {
      storage.updateDataSourceStatus(source.id, 'failed')
      throw error
    }
  })

  ipcMain.handle('nova:data-source:test', async (_event, payload) => {
    const input = prepareDataSourceInput(dataSourceSchema.parse(payload) as DataSourceInput)
    const password = input.password || (input.id ? storage.getDataSourceSecret(input.id) : '')
    const session = new DbhubSession()
    try {
      const tools = await session.connect(buildDsn(input, password))
      if (!tools.tools.some((tool) => tool.name === 'execute_sql')) {
        throw new Error('DBHub 未提供查询工具。')
      }
      if (input.id) storage.updateDataSourceStatus(input.id, 'connected')
      return { ok: true, message: '连接成功，数据库权限由连接账号决定。' }
    } catch (error) {
      if (input.id) storage.updateDataSourceStatus(input.id, 'failed')
      return { ok: false, message: error instanceof Error ? error.message : '无法连接数据库。' }
    } finally {
      await session.close()
    }
  })

  ipcMain.handle('nova:data-source:choose-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择 SQLite 数据库',
      properties: ['openFile'],
      filters: [
        { name: 'SQLite 数据库', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  ipcMain.handle('nova:model-channel:save', (_event, payload) => {
    return storage.saveModelChannel(modelChannelSchema.parse(payload))
  })

  ipcMain.handle('nova:model-channel:delete', (_event, id: string) => {
    storage.deleteModelChannel(z.string().uuid().parse(id))
  })

  ipcMain.handle('nova:model:list', async (_event, payload) => {
    const input = modelListSchema.parse(payload)
    return fetchModelIds(input.baseUrl, input.apiKey || (input.channelId ? storage.getModelChannelApiKey(input.channelId) : ''))
  })

  ipcMain.handle('nova:setup:complete', (_event, payload) => {
    const input = z.object({
      dataSource: dataSourceSchema,
      modelChannel: modelChannelSchema,
    }).parse(payload)
    return storage.completeInitialSetup(prepareDataSourceInput(input.dataSource), input.modelChannel)
  })

  ipcMain.handle('nova:agent:ask', async (event, payload) => {
    const input = askSchema.parse(payload)
    const source = storage.getDataSource(input.dataSourceId)
    const channel = storage.getModelChannel(input.modelChannelId)
    const startedAt = Date.now()
    const processLogs: AgentProgressEvent[] = []

    try {
      if (!source) throw new Error('当前数据源不存在，请重新选择。')
      if (!channel) throw new Error('模型提供商不存在，请重新选择。')
      const apiKey = storage.getModelChannelApiKey(channel.id)
      const schemaCache = storage.getSchemaCacheRecord(source.id)
      const result = await runAgent({
        queryId: input.queryId,
        question: input.displayQuestion ?? input.question,
        source,
        password: storage.getDataSourceSecret(source.id),
        apiKey,
        baseUrl: channel.baseUrl,
        model: input.model,
        schemaCache: schemaCache?.schemaJson ?? null,
        schemaCacheNeedsRefresh: schemaCache ? isSchemaCacheStale(schemaCache.refreshedAt) : false,
        onSchemaLoaded: (schemaJson) => storage.saveSchemaCache(source.id, schemaJson),
        onSchemaChanged: () => storage.clearSchemaCache(source.id),
        onProgress: (progress) => {
          upsertProgress(processLogs, progress)
          event.sender.send('nova:agent:progress', progress)
        },
      })
      return storage.saveQueryRun({
        dataSourceId: source.id,
        dataSourceName: source.name,
        question: input.displayQuestion ?? input.question,
        answer: result.answer,
        sql: result.sql,
        table: result.table,
        chart: result.chart,
        status: 'success',
        error: null,
        durationMs: Date.now() - startedAt,
        mode: 'smart',
        model: `${channel.name} · ${input.model}`,
        processLogs,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '查询失败，请稍后重试。'
      return storage.saveQueryRun({
        dataSourceId: input.dataSourceId,
        dataSourceName: source?.name ?? '未知数据源',
        question: input.question,
        answer: '',
        sql: '',
        table: null,
        chart: null,
        status: 'error',
        error: message,
        durationMs: Date.now() - startedAt,
        mode: 'smart',
        model: `${channel?.name ?? '未知提供商'} · ${input.model}`,
        processLogs,
      })
    }
  })

  ipcMain.handle('nova:funnel:recommend', async (_event, payload) => {
    const input = funnelRecommendationSchema.parse(payload)
    const source = storage.getDataSource(input.dataSourceId)
    const channel = storage.getModelChannel(input.modelChannelId)
    if (!source) throw new Error('当前数据源不存在，请重新选择。')
    if (!channel) throw new Error('模型提供商不存在，请重新选择。')

    const cached = storage.getSchemaCacheRecord(source.id)
    let schemaJson = cached?.schemaJson ?? ''
    if (!cached || isSchemaCacheStale(cached.refreshedAt)) {
      const session = new DbhubSession()
      try {
        await session.connect(buildDsn(source, storage.getDataSourceSecret(source.id)))
        const resolved = await resolveSchemaSnapshot({
          cachedSchema: cached?.schemaJson ?? null,
          needsRefresh: Boolean(cached),
          loadFresh: () => loadSchemaSnapshot(session),
          saveFresh: (freshSchema) => storage.saveSchemaCache(source.id, freshSchema),
        })
        schemaJson = resolved.schemaJson
      } finally {
        await session.close()
      }
    }
    if (!schemaJson) throw new Error('暂时无法读取数据结构，请先在设置中重建结构缓存。')

    return recommendFunnels({
      schemaJson,
      sourceType: source.type,
      apiKey: storage.getModelChannelApiKey(channel.id),
      baseUrl: channel.baseUrl,
      model: input.model,
      focus: input.focus,
    })
  })

  ipcMain.handle('nova:sql:execute', async (event, payload) => {
    const input = sqlQuerySchema.parse(payload)
    const source = storage.getDataSource(input.dataSourceId)
    const startedAt = Date.now()
    const session = new DbhubSession()
    const processLogs: AgentProgressEvent[] = []
    const progress = createIpcProgress(event.sender, processLogs, input.queryId)
    let currentStep: ReturnType<typeof progress> | null = null
    try {
      if (!source) throw new Error('当前数据源不存在，请重新选择。')
      const connectionDetail = describeConnection(source)
      currentStep = progress('schema', '连接数据库', `${connectionDetail}\n状态：正在建立连接`)
      const tools = await session.connect(buildDsn(source, storage.getDataSourceSecret(source.id)))
      if (!tools.tools.some((tool) => tool.name === 'execute_sql')) {
        throw new Error('DBHub 未提供 SQL 执行工具。')
      }
      currentStep.success(`${connectionDetail}\n状态：连接成功，已确认 SQL 执行能力`)
      const cachedSchema = storage.getSchemaCacheRecord(source.id)
      const schemaCacheNeedsRefresh = cachedSchema ? isSchemaCacheStale(cachedSchema.refreshedAt) : false
      currentStep = progress(
        'schema',
        schemaCacheNeedsRefresh ? '更新元数据缓存' : cachedSchema ? '读取元数据缓存' : '缓存数据库结构',
        schemaCacheNeedsRefresh ? '缓存已超过 24 小时，正在从数据库重新读取结构' : cachedSchema ? '正在读取本地数据库结构缓存' : '正在从数据库读取 Schema、表、视图、字段、函数和索引',
      )
      const resolvedSchema = await resolveSchemaSnapshot({
        cachedSchema: cachedSchema?.schemaJson ?? null,
        needsRefresh: schemaCacheNeedsRefresh,
        loadFresh: () => loadSchemaSnapshot(session),
        saveFresh: (schemaJson) => storage.saveSchemaCache(source.id, schemaJson),
      })
      currentStep.success([
        describeSchema(resolvedSchema.schemaJson, resolvedSchema.source !== 'fresh'),
        ...(resolvedSchema.source === 'stale-fallback' ? ['缓存更新失败，本次继续使用已有结构'] : []),
      ].join('\n'))
      currentStep = progress('querying', '执行 SQL', `准备执行：\n${input.sql}`)
      const table = await executeSql(session, input.sql)
      if (changesSchemaSql(input.sql)) storage.clearSchemaCache(source.id)
      const summary = executionSummary(table)
      currentStep.success(`SQL：\n${input.sql}\n\n${describeQueryResult(table)}`, table)
      currentStep = null
      const formattedQuestion = input.question ?? (input.sql.replace(/\s+/g, ' ').trim().slice(0, 120) || 'SQL 查询')
      return storage.saveQueryRun({
        dataSourceId: input.dataSourceId,
        dataSourceName: source.name,
        question: formattedQuestion,
        answer: `SQL 执行完成，${summary}。`,
        sql: input.sql,
        table,
        chart: input.chart ?? null,
        status: 'success',
        error: null,
        durationMs: Date.now() - startedAt,
        mode: 'sql',
        processLogs,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'SQL 查询失败，请稍后重试。'
      currentStep?.error(message)
      const formattedQuestion = input.question ?? (input.sql.replace(/\s+/g, ' ').trim().slice(0, 120) || 'SQL 查询')
      return storage.saveQueryRun({
        dataSourceId: input.dataSourceId,
        dataSourceName: source?.name ?? '未知数据源',
        question: formattedQuestion,
        answer: '',
        sql: input.sql,
        table: null,
        chart: input.chart ?? null,
        status: 'error',
        error: message,
        durationMs: Date.now() - startedAt,
        mode: 'sql',
        processLogs,
      })
    } finally {
      await session.close()
    }
  })

  ipcMain.handle('nova:sql:save', (_event, payload) => {
    const input = savedSqlSchema.parse(payload)
    if (!storage.getDataSource(input.dataSourceId)) throw new Error('数据源不存在。')
    return storage.saveSql(input)
  })

  ipcMain.handle('nova:sql:delete', (_event, id: string) => {
    storage.deleteSavedSql(z.string().uuid().parse(id))
  })

  ipcMain.handle('nova:task:save', (_event, payload) => {
    return storage.saveScheduledTask(scheduledTaskSchema.parse(payload))
  })

  ipcMain.handle('nova:task:delete', (_event, id: string) => {
    storage.deleteScheduledTask(z.string().uuid().parse(id))
  })

  ipcMain.handle('nova:task:run', async (_event, id: string) => {
    const task = storage.getScheduledTask(z.string().uuid().parse(id))
    if (!task) throw new Error('定时任务不存在。')
    return executeScheduledTask(task)
  })

  ipcMain.handle('nova:dashboard:save', (_event, payload) => {
    return storage.saveDashboard(dashboardSchema.parse(payload))
  })

  ipcMain.handle('nova:dashboard:delete', (_event, id: string) => {
    storage.deleteDashboard(z.string().uuid().parse(id))
  })

  ipcMain.handle('nova:dashboard:export', async (_event, payload) => {
    const input = dashboardExportSchema.parse(payload)
    const safeName = input.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Nova 看板'
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: input.format === 'html' ? '导出 HTML 看板' : '导出看板图片',
      defaultPath: `${safeName}.${input.format}`,
      filters: input.format === 'html'
        ? [{ name: 'HTML 文件', extensions: ['html'] }]
        : [{ name: 'PNG 图片', extensions: ['png'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    if (input.format === 'png') {
      const match = input.data.match(/^data:image\/png;base64,(.+)$/)
      if (!match) throw new Error('看板图片数据无效。')
      await writeFile(result.filePath, Buffer.from(match[1]!, 'base64'))
    } else {
      await writeFile(result.filePath, input.data, 'utf8')
    }
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('nova:query:update', (_event, id: string, patch) => {
    return storage.updateQueryRun(
      z.string().uuid().parse(id),
      z.object({ isFavorite: z.boolean().optional(), isPinned: z.boolean().optional(), chart: chartSpecSchema.nullable().optional() }).parse(patch),
    )
  })

  ipcMain.handle('nova:config:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '导出 Nova 配置',
      defaultPath: `nova-config-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'Nova 配置', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    await writeFile(result.filePath, `${JSON.stringify(storage.exportableConfig(), null, 2)}\n`, { mode: 0o600 })
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('nova:config:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '导入 Nova 配置',
      properties: ['openFile'],
      filters: [{ name: 'Nova 配置', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const raw = await readFile(result.filePaths[0], 'utf8')
    const portableFavoriteRunSchema = z.object({
      dataSourceName: z.string().trim().min(1).max(80),
      question: z.string().max(4000),
      answer: z.string().max(200_000),
      sql: z.string().max(200_000),
      chart: chartSpecSchema.nullable().default(null),
      status: z.enum(['success', 'error']),
      error: z.string().nullable().default(null),
      durationMs: z.number().int().min(0).default(0),
      mode: z.enum(['smart', 'sql']).default('smart'),
      model: z.string().nullable().default(null),
      createdAt: z.string(),
    })
    const parsed = z.discriminatedUnion('version', [
      z.object({
        format: z.literal('nova-config'),
        version: z.literal(1),
        dataSources: z.array(dataSourceSchema.omit({ password: true })).max(100),
        settings: portableModelSchema.optional(),
      }),
      z.object({
        format: z.literal('nova-config'),
        version: z.literal(2),
        dataSources: z.array(dataSourceSchema.omit({ password: true })).max(100),
        model: portableModelSchema.optional(),
        savedSql: z.array(portableSavedSqlSchema).max(5000).default([]),
      }),
      z.object({
        format: z.literal('nova-config'),
        version: z.literal(3),
        dataSources: z.array(dataSourceSchema).max(100),
        model: portableModelSchema.extend({ apiKey: z.string().max(4096).optional() }).optional(),
        savedSql: z.array(portableSavedSqlSchema).max(5000).default([]),
      }),
      z.object({
        format: z.literal('nova-config'),
        version: z.literal(4),
        dataSources: z.array(dataSourceSchema).max(100),
        model: portableModelSchema.extend({ apiKey: z.string().max(4096).optional() }).optional(),
        savedSql: z.array(portableSavedSqlSchema).max(5000).default([]),
        favoriteRuns: z.array(portableFavoriteRunSchema).max(10000).default([]),
      }),
      z.object({
        format: z.literal('nova-config'),
        version: z.literal(5),
        dataSources: z.array(dataSourceSchema).max(100),
        model: portableModelSchema.extend({ apiKey: z.string().max(4096).optional() }).optional(),
        savedSql: z.array(portableGlobalSavedSqlSchema).max(5000).default([]),
        favoriteRuns: z.array(portableFavoriteRunSchema).max(10000).default([]),
      }),
      z.object({
        format: z.literal('nova-config'),
        version: z.literal(6),
        dataSources: z.array(dataSourceSchema).max(100),
        modelChannels: z.array(portableModelChannelSchema).max(100).default([]),
        savedSql: z.array(portableGlobalSavedSqlSchema).max(5000).default([]),
        favoriteRuns: z.array(portableFavoriteRunSchema).max(10000).default([]),
      }),
    ]).parse(JSON.parse(raw))
    const legacyModel = parsed.version === 6 ? undefined : parsed.version === 1 ? parsed.settings : parsed.model
    const modelResult = parsed.version === 6
      ? storage.importModelChannels(parsed.modelChannels)
      : legacyModel ? storage.importModelSettings(legacyModel) : { imported: 0, skipped: 0 }
    const favoriteRuns = 'favoriteRuns' in parsed ? parsed.favoriteRuns : []
    const summary = storage.importConfiguration(parsed.dataSources.map(prepareDataSourceInput), parsed.version === 1 ? [] : parsed.savedSql, favoriteRuns)
    return { canceled: false, summary: { ...summary, modelChannelsImported: modelResult.imported, modelChannelsSkipped: modelResult.skipped } }
  })

  ipcMain.handle('nova:sql:batch-import', (_event, payload) => {
    const input = batchImportSqlSchema.parse(payload)
    if (!storage.getDataSource(input.dataSourceId)) throw new Error('数据源不存在。')
    const raw = input.content

    // Parse format: lines starting with "-- " are names, everything until the next name line is the SQL body
    const entries: Array<{ name: string; sql: string }> = []
    let currentName: string | null = null
    let currentLines: string[] = []
    for (const line of raw.split('\n')) {
      const nameMatch = line.match(/^--\s+(.+)$/)
      if (nameMatch) {
        if (currentName !== null) {
          const sql = currentLines.join('\n').trim()
          if (sql) entries.push({ name: currentName, sql })
        }
        currentName = nameMatch[1]!.trim()
        currentLines = []
      } else {
        currentLines.push(line)
      }
    }
    if (currentName !== null) {
      const sql = currentLines.join('\n').trim()
      if (sql) entries.push({ name: currentName, sql })
    }

    if (!entries.length) throw new Error('未找到有效的 SQL 条目。格式：以 "-- 名称" 开头，后跟 SQL 语句。')

    const existingSql = new Set(
      storage.listSavedSql()
        .filter((item) => item.dataSourceId === input.dataSourceId)
        .map((item) => item.sql.trim()),
    )
    const existingNames = new Set(storage.listSavedSql()
      .filter((item) => item.dataSourceId === input.dataSourceId)
      .map((item) => item.name.toLocaleLowerCase()))
    let imported = 0
    let skipped = 0
    for (const entry of entries) {
      if (existingSql.has(entry.sql.trim())) {
        skipped += 1
        continue
      }
      const name = uniqueImportedName(entry.name, existingNames)
      storage.saveSql({ dataSourceId: input.dataSourceId, name, sql: entry.sql })
      existingSql.add(entry.sql.trim())
      imported += 1
    }
    return { imported, skipped }
  })

  ipcMain.handle('nova:app:check-update', async () => {
    const appUpdate = await checkAppUpdate()
    if (appUpdate.hasUpdate) return { ...appUpdate, updateKind: 'app' as const }
    if (!app.isPackaged) return appUpdate
    const rendererUpdate = await rendererUpdater.checkForUpdate()
    if (!rendererUpdate) return appUpdate
    return {
      hasUpdate: true,
      updateKind: 'renderer' as const,
      currentVersion: app.getVersion(),
      latestVersion: app.getVersion(),
      releaseName: 'Nova 界面更新',
      releaseNotes: rendererUpdate.releaseNotes,
      publishedAt: rendererUpdate.publishedAt,
      downloadSize: rendererUpdate.downloadSize,
      htmlUrl: rendererUpdate.htmlUrl,
    }
  })
  ipcMain.handle('nova:app:download-update', (event, downloadUrl: string) => {
    return downloadAppUpdate(downloadUrl, (progress) => event.sender.send('nova:app:update-progress', progress))
  })
  ipcMain.handle('nova:app:open-downloaded-update', () => openDownloadedUpdate())
  ipcMain.handle('nova:app:apply-renderer-update', async (event) => {
    const result = await rendererUpdater.downloadAndStage((progress) => {
      event.sender.send('nova:app:update-progress', progress)
    })
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(RENDERER_URL)
    }, 300)
    return result
  })
  ipcMain.handle('nova:renderer:ready', async (event) => {
    if (event.sender !== mainWindow?.webContents) return
    if (rendererReadyTimer) clearTimeout(rendererReadyTimer)
    rendererReadyTimer = null
    await rendererUpdater.confirmPendingUpdate()
  })
}

app.whenReady().then(async () => {
  const rendererConfig = rendererConfigSchema.parse(JSON.parse(
    await readFile(path.join(app.getAppPath(), 'renderer-update.json'), 'utf8'),
  ))
  rendererUpdater = new RendererUpdater({
    appVersion: app.getVersion(),
    shellApiVersion: rendererConfig.shellApiVersion,
    publicKey: rendererConfig.publicKey,
    builtInDirectory: path.join(app.getAppPath(), 'dist'),
    userDataDirectory: app.getPath('userData'),
  })
  await rendererUpdater.initialize()
  protocol.handle('nova', rendererProtocolResponse)
  const demoDatabaseChanged = ensureDemoDatabase(demoDatabasePath())
  storage = new Storage(path.join(app.getPath('userData'), 'nova.sqlite'))
  let demoSource = storage.listDataSources().find((source) => source.type === 'demo')
  if (!demoSource) {
    demoSource = storage.saveDataSource(prepareDataSourceInput({ name: 'Nova 示例商店', type: 'demo' }))
  }
  storage.updateDataSourceStatus(demoSource.id, 'connected')
  const demoCache = storage.getSchemaCacheRecord(demoSource.id)
  if (demoDatabaseChanged || !demoCache || isSchemaCacheStale(demoCache.refreshedAt)) {
    try {
      await rebuildSchemaCacheForSource(demoSource)
    } catch (error) {
      console.error('Failed to prepare demo schema cache:', error)
    }
  }
  registerIpc()
  taskScheduler = new TaskScheduler(
    (now) => storage.listDueScheduledTasks(now),
    async (task) => { await executeScheduledTask(task) },
  )
  taskScheduler.start()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  taskScheduler?.stop()
  storage?.close()
})
