import type { SchemaRelationInfo } from '../shared/types.js'
import { extractSchemaCacheStructure } from './schema-cache.js'

export const MAX_SCHEMA_CONTEXT_CHARS = 100_000
const MAX_CATALOG_CHARS = 25_000

const GENERIC_TERMS = new Set([
  '查询', '查看', '统计', '分析', '数据', '结果', '记录', '数量', '多少', '哪些', '所有', '相关',
  'the', 'and', 'for', 'from', 'with', 'show', 'find', 'list', 'count', 'data',
])

function searchTerms(question: string) {
  const terms = new Set<string>()
  const chunks = question.match(/[\p{L}\p{N}_]+/gu) ?? []
  for (const chunk of chunks) {
    const normalized = chunk.toLocaleLowerCase()
    if (/^[\p{Script=Han}]+$/u.test(normalized)) {
      if (normalized.length <= 6) terms.add(normalized)
      for (let size = 2; size <= Math.min(4, normalized.length); size += 1) {
        for (let index = 0; index <= normalized.length - size; index += 1) {
          terms.add(normalized.slice(index, index + size))
        }
      }
    } else {
      terms.add(normalized)
      normalized.split('_').filter(Boolean).forEach((term) => terms.add(term))
    }
  }
  return [...terms].filter((term) => term.length >= 2 && !GENERIC_TERMS.has(term)).slice(0, 80)
}

function relationScore(schema: string, relation: SchemaRelationInfo, question: string, terms: string[]) {
  const normalizedQuestion = question.toLocaleLowerCase()
  const name = relation.name.toLocaleLowerCase()
  const qualifiedName = `${schema}.${relation.name}`.toLocaleLowerCase()
  const comment = relation.comment?.toLocaleLowerCase() ?? ''
  const columns = relation.columns
    .map((column) => [column.name, column.type, column.description].filter(Boolean).join(' '))
    .join(' ')
    .toLocaleLowerCase()
  let score = 0
  if (normalizedQuestion.includes(qualifiedName)) score += 80
  if (normalizedQuestion.includes(name)) score += 50
  for (const term of terms) {
    if (name === term || name.split(/[_\W]+/u).includes(term)) score += 18
    else if (name.includes(term)) score += 12
    if (comment.includes(term)) score += 6
    if (columns.includes(term)) score += 4
  }
  return score
}

function contextRelation(schema: string, relation: SchemaRelationInfo) {
  return {
    schema,
    type: relation.type,
    name: relation.name,
    ...(relation.comment ? { comment: relation.comment } : {}),
    columns: relation.columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      ...(column.description ? { description: column.description } : {}),
    })),
  }
}

export function buildSchemaContext(schemaJson: string, question: string, maxChars = MAX_SCHEMA_CONTEXT_CHARS) {
  const structure = extractSchemaCacheStructure('context', schemaJson)
  if (!structure.schemas.length) return schemaJson.slice(0, maxChars)

  let capturedAt: string | null = null
  try {
    const parsed = JSON.parse(schemaJson) as { capturedAt?: unknown }
    capturedAt = typeof parsed.capturedAt === 'string' ? parsed.capturedAt : null
  } catch {
    // The sanitized structure above is still usable for compatible cache formats.
  }

  const terms = searchTerms(question)
  const relations = structure.schemas.flatMap((schema) => schema.relations.map((relation) => ({
    schema: schema.name,
    relation,
    score: relationScore(schema.name, relation, question, terms),
  })))
  relations.sort((left, right) => right.score - left.score
    || left.schema.localeCompare(right.schema)
    || left.relation.name.localeCompare(right.relation.name))

  const catalog: string[] = []
  let catalogChars = 0
  for (const item of relations) {
    const entry = `${item.schema}.${item.relation.name} [${item.relation.type}]`
    const entryChars = JSON.stringify(entry).length + 1
    if (catalogChars + entryChars > Math.min(MAX_CATALOG_CHARS, Math.floor(maxChars * 0.3))) break
    catalog.push(entry)
    catalogChars += entryChars
  }

  const detailedRelations: ReturnType<typeof contextRelation>[] = []
  const base = {
    version: 2,
    capturedAt,
    totalRelations: relations.length,
    catalog,
    relations: detailedRelations,
    omittedRelationDetails: relations.length,
  }
  const emptyContextLength = JSON.stringify(base).length
  let remainingChars = Math.max(0, maxChars - emptyContextLength)
  for (const item of relations) {
    const relation = contextRelation(item.schema, item.relation)
    const relationChars = JSON.stringify(relation).length + (detailedRelations.length ? 1 : 0)
    if (relationChars > remainingChars) continue
    detailedRelations.push(relation)
    remainingChars -= relationChars
  }
  base.omittedRelationDetails = relations.length - detailedRelations.length

  let context = JSON.stringify(base)
  while (context.length > maxChars && catalog.length) {
    catalog.pop()
    context = JSON.stringify(base)
  }
  return context.slice(0, maxChars)
}
