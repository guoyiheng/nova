import type { SchemaCacheError, SchemaCacheInfo, SchemaObjectCounts, SchemaObjectType } from '../shared/types.js'

const SCHEMA_OBJECT_TYPES: SchemaObjectType[] = ['table', 'view', 'column', 'procedure', 'function', 'index']

function emptyCounts(): SchemaObjectCounts {
  return { table: 0, view: 0, column: 0, procedure: 0, function: 0, index: 0 }
}

export function missingSchemaCacheInfo(dataSourceId: string): SchemaCacheInfo {
  return {
    dataSourceId,
    state: 'missing',
    refreshedAt: null,
    capturedAt: null,
    sizeBytes: 0,
    schemaCount: 0,
    counts: emptyCounts(),
    errors: [],
  }
}

export function inspectSchemaCache(dataSourceId: string, schemaJson: string, refreshedAt: string): SchemaCacheInfo {
  const counts = emptyCounts()
  const errors: SchemaCacheError[] = []
  let capturedAt: string | null = null
  let schemaCount = 0

  try {
    const parsed = JSON.parse(schemaJson) as {
      capturedAt?: unknown
      schemas?: Record<string, Record<string, { results?: unknown[]; error?: unknown }>>
    }
    capturedAt = typeof parsed.capturedAt === 'string' ? parsed.capturedAt : null
    const schemas = parsed.schemas && typeof parsed.schemas === 'object' ? parsed.schemas : {}
    schemaCount = Object.keys(schemas).length
    for (const [schemaName, schema] of Object.entries(schemas)) {
      for (const objectType of SCHEMA_OBJECT_TYPES) {
        const payload = schema?.[objectType]
        if (Array.isArray(payload?.results)) counts[objectType] += payload.results.length
        if (typeof payload?.error === 'string') {
          errors.push({ schema: schemaName, objectType, message: payload.error })
        }
      }
    }
  } catch (error) {
    errors.push({
      schema: 'unknown',
      objectType: 'table',
      message: error instanceof Error ? error.message : '缓存格式无效。',
    })
  }

  return {
    dataSourceId,
    state: errors.length ? 'partial' : 'ready',
    refreshedAt,
    capturedAt,
    sizeBytes: Buffer.byteLength(schemaJson, 'utf8'),
    schemaCount,
    counts,
    errors,
  }
}
