import { app } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { QueryTable } from '../shared/types.js'
import { isWriteSql } from './dbhub-utils.js'

export { buildDsn } from './dbhub-utils.js'
export const MAX_QUERY_ROWS = 1000

export function dbhubEntryPath(appPath = app.getAppPath()) {
  return path.join(appPath, 'node_modules', '@bytebase', 'dbhub', 'dist', 'index.js')
}

export function buildDbhubConfig() {
  return `[[sources]]
id = "nova"
dsn = "\${NOVA_DB_DSN}"
connection_timeout = 10
query_timeout = 30

[[tools]]
name = "search_objects"
source = "nova"

[[tools]]
name = "execute_sql"
source = "nova"
readonly = false
max_rows = ${MAX_QUERY_ROWS}
`
}

export function formatDbhubConnectionError(error: unknown, stderr = ''): string {
  const message = error instanceof Error ? error.message : String(error)
  const normalizedStderr = stderr.replace(/\x1b\[[0-9;]*m/g, '')
  const prefixedErrors = Array.from(normalizedStderr.matchAll(
    /(?:Failed to connect to [^\r\n]*?:|Fatal error:)\s*(?:Error:\s*)?([^\r\n]+)/gi,
  ))
  const directErrors = Array.from(normalizedStderr.matchAll(/^\s*Error:\s*([^\r\n]+)/gim))
  return prefixedErrors.at(-1)?.[1]?.trim() || directErrors.at(-1)?.[1]?.trim() || message
}

export class DbhubSession {
  private client: Client | null = null
  private tempDirectory = ''
  private stderrOutput = ''

  private captureStderr(chunk: unknown) {
    this.stderrOutput = `${this.stderrOutput}${String(chunk)}`.slice(-16_000)
  }

  private connectionError(error: unknown) {
    return new Error(formatDbhubConnectionError(error, this.stderrOutput), { cause: error })
  }

  async connect(dsn: string) {
    this.stderrOutput = ''
    this.tempDirectory = await mkdtemp(path.join(tmpdir(), 'nova-dbhub-'))
    const configPath = path.join(this.tempDirectory, 'dbhub.toml')
    await writeFile(configPath, buildDbhubConfig(), { mode: 0o600 })

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [dbhubEntryPath(), '--transport', 'stdio', '--config', configPath],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NOVA_DB_DSN: dsn,
      },
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => this.captureStderr(chunk))

    this.client = new Client({ name: 'nova', version: '0.1.0' })
    try {
      await this.client.connect(transport)
      return await this.client.listTools()
    } catch (error) {
      const connectionError = this.connectionError(error)
      await this.close().catch(() => undefined)
      throw connectionError
    }
  }

  async listTools() {
    if (!this.client) throw new Error('DBHub 尚未连接。')
    try {
      return await this.client.listTools()
    } catch (error) {
      throw this.connectionError(error)
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.client) throw new Error('DBHub 尚未连接。')
    try {
      return await this.client.callTool({ name, arguments: args }) as CallToolResult
    } catch (error) {
      throw this.connectionError(error)
    }
  }

  async close() {
    try {
      await this.client?.close()
    } finally {
      this.client = null
      if (this.tempDirectory) await rm(this.tempDirectory, { recursive: true, force: true })
    }
  }
}

export function toolResultText(result: CallToolResult): string {
  return result.content
    .filter((item): item is Extract<(typeof result.content)[number], { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
}

type ToolPayload = {
  success?: boolean
  error?: { message?: string } | string
  data?: Record<string, unknown> & {
    rows?: Array<Record<string, unknown>>
    count?: number
    results?: Array<Record<string, unknown>>
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const cleaned = value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

function toolPayload(result: CallToolResult): ToolPayload {
  const text = toolResultText(result)
  const payload = parseJsonObject(text) as ToolPayload | null
  const error = typeof payload?.error === 'string' ? payload.error : payload?.error?.message
  if (result.isError || payload?.success === false) {
    throw new Error(error || text || 'DBHub 查询失败。')
  }
  if (!payload) throw new Error('DBHub 返回了无法解析的结果。')
  return payload
}

export function parseQueryTable(result: CallToolResult, sql = ''): QueryTable {
  const payload = toolPayload(result)
  const rows = payload.data?.rows
  if (!Array.isArray(rows)) throw new Error('DBHub 未返回表格数据。')
  const limitedRows = rows.slice(0, MAX_QUERY_ROWS)
  const columns = Array.from(new Set(limitedRows.flatMap((row) => Object.keys(row))))
  const affectedRows = isWriteSql(sql) ? payload.data?.count ?? 0 : undefined
  return {
    columns,
    rows: limitedRows,
    truncated: affectedRows === undefined && (rows.length > limitedRows.length || (payload.data?.count ?? 0) > limitedRows.length),
    ...(affectedRows !== undefined ? { affectedRows } : {}),
  }
}

export async function executeSql(session: DbhubSession, sql: string): Promise<QueryTable> {
  return parseQueryTable(await session.callTool('execute_sql', { sql }), sql)
}

export async function loadSchemaSnapshot(session: DbhubSession): Promise<string> {
  const capturedAt = new Date().toISOString()
  const schemaResult = toolPayload(await session.callTool('search_objects', {
    object_type: 'schema',
    pattern: '%',
    detail_level: 'full',
    limit: 1000,
  }))
  const schemaItems = schemaResult.data?.results ?? []
  const schemaNames = Array.from(new Set(schemaItems
    .map((item) => typeof item.name === 'string' ? item.name : typeof item.schema === 'string' ? item.schema : '')
    .filter(Boolean)))
  const targets: Array<string | null> = schemaNames.length ? schemaNames : [null]
  const objectTypes = ['table', 'view', 'column', 'procedure', 'function', 'index'] as const
  const schemas: Record<string, Record<string, unknown>> = {}

  for (const schemaName of targets) {
    const key = schemaName ?? 'default'
    schemas[key] = {}
    for (const objectType of objectTypes) {
      try {
        const payload = toolPayload(await session.callTool('search_objects', {
          object_type: objectType,
          pattern: '%',
          ...(schemaName ? { schema: schemaName } : {}),
          detail_level: 'full',
          limit: 1000,
        }))
        schemas[key][objectType] = payload.data ?? {}
      } catch (error) {
        schemas[key][objectType] = {
          error: error instanceof Error ? error.message : '无法读取该对象类型。',
        }
      }
    }
  }

  return JSON.stringify({
    version: 1,
    capturedAt,
    schema: schemaResult.data ?? {},
    schemas,
  })
}
