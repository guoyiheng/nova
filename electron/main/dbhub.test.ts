import { describe, expect, it } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import path from 'node:path'
import { buildDbhubConfig, dbhubEntryPath, formatDbhubConnectionError, loadSchemaSnapshot, MAX_QUERY_ROWS, parseQueryTable, type DbhubSession } from './dbhub.js'

function result(payload: unknown, isError = false): CallToolResult {
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

describe('parseQueryTable', () => {
  it('collects columns from every returned row', () => {
    expect(parseQueryTable(result({
      success: true,
      data: { rows: [{ id: 1, name: 'Nova' }, { id: 2, total: 42 }], count: 2 },
    }))).toEqual({
      columns: ['id', 'name', 'total'],
      rows: [{ id: 1, name: 'Nova' }, { id: 2, total: 42 }],
      truncated: false,
    })
  })

  it('marks results truncated when DBHub reports more rows', () => {
    expect(parseQueryTable(result({
      success: true,
      data: { rows: [{ id: 1 }], count: 1000 },
    })).truncated).toBe(true)
  })

  it('keeps the same row limit configured for DBHub', () => {
    const rows = Array.from({ length: MAX_QUERY_ROWS + 1 }, (_, id) => ({ id }))
    const table = parseQueryTable(result({
      success: true,
      data: { rows, count: rows.length },
    }))

    expect(table.rows).toHaveLength(MAX_QUERY_ROWS)
    expect(table.rows.at(-1)).toEqual({ id: MAX_QUERY_ROWS - 1 })
    expect(table.truncated).toBe(true)
    expect(buildDbhubConfig()).toContain(`max_rows = ${MAX_QUERY_ROWS}`)
  })

  it('reports affected rows for write statements', () => {
    expect(parseQueryTable(result({
      success: true,
      data: { rows: [], count: 12 },
    }), 'UPDATE orders SET archived = true')).toEqual({
      columns: [],
      rows: [],
      truncated: false,
      affectedRows: 12,
    })
  })

  it('surfaces DBHub errors', () => {
    expect(() => parseQueryTable(result({ success: false, error: { message: 'invalid query' } }, true)))
      .toThrow('invalid query')
  })
})

describe('buildDbhubConfig', () => {
  it('enables database writes while retaining operational limits', () => {
    const config = buildDbhubConfig()
    expect(config).toContain('readonly = false')
    expect(config).toContain(`max_rows = ${MAX_QUERY_ROWS}`)
    expect(config).toContain('query_timeout = 30')
  })

  it('keeps the packaged DBHub entry inside ASAR for module resolution', () => {
    expect(dbhubEntryPath('/Applications/Nova.app/Contents/Resources/app.asar'))
      .toBe(path.join(
        '/Applications/Nova.app/Contents/Resources/app.asar',
        'node_modules',
        '@bytebase',
        'dbhub',
        'dist',
        'index.js',
      ))
  })
})

describe('formatDbhubConnectionError', () => {
  it('returns the original packaged runtime error', () => {
    expect(formatDbhubConnectionError(
      new Error('MCP error -32000: Connection closed'),
      "Fatal error: Error: Cannot find module 'asn1'\nRequire stack: ...",
    )).toBe("Cannot find module 'asn1'")
  })

  it('returns database connection errors from DBHub stderr unchanged', () => {
    const closed = new Error('MCP error -32000: Connection closed')
    const stderr = [
      'Connecting to 1 database source(s)...',
      'Failed to connect to MySQL database: Error: Connection lost: The server closed the connection.',
      '    at Socket.<anonymous> (/app/node_modules/mysql2/lib/base/connection.js:125:31)',
      'Fatal error: Error: Connection lost: The server closed the connection.',
    ].join('\n')

    expect(formatDbhubConnectionError(closed, stderr))
      .toBe('Connection lost: The server closed the connection.')
  })

  it('returns the MCP error unchanged when DBHub provides no database error', () => {
    expect(formatDbhubConnectionError(new Error('MCP error -32000: Connection closed')))
      .toBe('MCP error -32000: Connection closed')
  })
})

describe('loadSchemaSnapshot', () => {
  it('loads every supported object type for each discovered schema', async () => {
    const calls: Array<Record<string, unknown>> = []
    const session = {
      callTool: async (_name: string, args: Record<string, unknown>) => {
        calls.push(args)
        const results = args.object_type === 'schema' ? [{ name: 'public' }] : []
        return result({ success: true, data: { results, count: results.length } })
      },
    } as unknown as DbhubSession

    const snapshot = JSON.parse(await loadSchemaSnapshot(session)) as {
      version: number
      schemas: Record<string, Record<string, unknown>>
    }

    expect(snapshot.version).toBe(1)
    expect(Object.keys(snapshot.schemas.public)).toEqual([
      'table',
      'view',
      'column',
      'procedure',
      'function',
      'index',
    ])
    expect(calls).toHaveLength(7)
    expect(calls.slice(1).every((call) => call.schema === 'public' && call.detail_level === 'full')).toBe(true)
  })
})
