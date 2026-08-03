import { describe, expect, it } from 'vitest'
import { extractSchemaCacheStructure, inspectSchemaCache, isSchemaCacheStale, missingSchemaCacheInfo, resolveSchemaSnapshot, SCHEMA_CACHE_MAX_AGE_MS } from './schema-cache.js'

describe('schema cache inspection', () => {
  it('reports a missing cache with zero counts', () => {
    expect(missingSchemaCacheInfo('source-1')).toMatchObject({
      dataSourceId: 'source-1',
      state: 'missing',
      schemaCount: 0,
      sizeBytes: 0,
    })
  })

  it('summarizes cached objects and partial failures', () => {
    const schemaJson = JSON.stringify({
      capturedAt: '2026-08-03T10:00:00.000Z',
      schemas: {
        public: {
          table: { results: [{ name: 'orders' }, { name: 'users' }] },
          view: { results: [{ name: 'daily_sales' }] },
          column: { results: [{ name: 'id' }, { name: 'total' }] },
          function: { error: 'permission denied' },
        },
      },
    })

    expect(inspectSchemaCache('source-1', schemaJson, '2026-08-03T10:01:00.000Z')).toMatchObject({
      state: 'partial',
      capturedAt: '2026-08-03T10:00:00.000Z',
      schemaCount: 1,
      counts: { table: 2, view: 1, column: 2 },
      errors: [{ schema: 'public', objectType: 'function', message: 'permission denied' }],
    })
  })

  it('extracts a sanitized schema browser structure', () => {
    const structure = extractSchemaCacheStructure('source-1', JSON.stringify({
      schemas: {
        public: {
          table: { results: [{
            name: 'orders',
            comment: 'Customer orders',
            row_count: 42,
            columns: [{ name: 'id', type: 'uuid', nullable: false, default: 'gen_random_uuid()' }],
          }] },
          view: { results: [{ name: 'daily_sales', columns: [{ name: 'day', type: 'date', nullable: true }] }] },
        },
      },
    }))

    expect(structure.schemas[0]?.relations).toEqual([
      { name: 'daily_sales', type: 'view', columns: [{ name: 'day', type: 'date', nullable: true }] },
      { name: 'orders', type: 'table', comment: 'Customer orders', columns: [{ name: 'id', type: 'uuid', nullable: false }] },
    ])
    expect(JSON.stringify(structure)).not.toContain('row_count')
    expect(JSON.stringify(structure)).not.toContain('gen_random_uuid')
  })

  it('marks caches older than the refresh interval as stale', () => {
    const refreshedAt = '2026-08-03T10:00:00.000Z'
    const refreshedTime = Date.parse(refreshedAt)
    expect(isSchemaCacheStale(refreshedAt, refreshedTime + SCHEMA_CACHE_MAX_AGE_MS - 1)).toBe(false)
    expect(inspectSchemaCache('source-1', '{"schemas":{}}', refreshedAt, refreshedTime + SCHEMA_CACHE_MAX_AGE_MS).state).toBe('stale')
  })

  it('keeps a stale snapshot when automatic refresh fails', async () => {
    const resolved = await resolveSchemaSnapshot({
      cachedSchema: '{"version":1}',
      needsRefresh: true,
      loadFresh: async () => { throw new Error('connection failed') },
      saveFresh: () => undefined,
    })

    expect(resolved.source).toBe('stale-fallback')
    expect(resolved.schemaJson).toBe('{"version":1}')
  })
})
