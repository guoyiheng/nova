import type { SchemaCacheError, SchemaCacheInfo, SchemaCacheStructure, SchemaColumnInfo, SchemaObjectCounts, SchemaObjectType, SchemaRelationInfo } from '../shared/types.js'

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

function textValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function normalizeColumn(value: unknown): SchemaColumnInfo | null {
  if (!value || typeof value !== 'object') return null
  const column = value as Record<string, unknown>
  const name = textValue(column.name)
  if (!name) return null
  const description = textValue(column.description)
  return {
    name,
    type: textValue(column.type),
    nullable: typeof column.nullable === 'boolean' ? column.nullable : null,
    ...(description ? { description } : {}),
  }
}

function normalizeRelation(value: unknown, type: SchemaRelationInfo['type']): SchemaRelationInfo | null {
  if (!value || typeof value !== 'object') return null
  const relation = value as Record<string, unknown>
  const name = textValue(relation.name)
  if (!name) return null
  const comment = textValue(relation.comment)
  return {
    name,
    type,
    ...(comment ? { comment } : {}),
    columns: Array.isArray(relation.columns)
      ? relation.columns.map(normalizeColumn).filter((column): column is SchemaColumnInfo => Boolean(column))
      : [],
  }
}

export function extractSchemaCacheStructure(dataSourceId: string, schemaJson: string): SchemaCacheStructure {
  try {
    const parsed = JSON.parse(schemaJson) as {
      schemas?: Record<string, Record<'table' | 'view', { results?: unknown[] }>>
    }
    const schemas = Object.entries(parsed.schemas ?? {}).map(([schemaName, schema]) => {
      const relations: SchemaRelationInfo[] = []
      for (const type of ['table', 'view'] as const) {
        const results = schema?.[type]?.results
        if (!Array.isArray(results)) continue
        for (const result of results) {
          const relation = normalizeRelation(result, type)
          if (relation) relations.push(relation)
        }
      }
      relations.sort((left, right) => left.name.localeCompare(right.name))
      return { name: schemaName, relations }
    })
    schemas.sort((left, right) => left.name.localeCompare(right.name))
    return { dataSourceId, schemas }
  } catch {
    return { dataSourceId, schemas: [] }
  }
}
