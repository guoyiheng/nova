import type { DatabaseType } from '../electron/shared/types'

export type FunnelConfig = {
  table: string
  actorColumn: string
  eventColumn: string
  timeColumn?: string
  startDate?: string
  endDate?: string
  steps: string[]
}

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*$/

export function parseFunnelSteps(value: string): string[] {
  return Array.from(new Set(value
    .split(/[\n,，]/)
    .map((step) => step.trim())
    .filter(Boolean)))
}

function quoteIdentifier(identifier: string, databaseType: DatabaseType) {
  const parts = identifier.trim().split('.')
  if (!parts.length || parts.some((part) => !IDENTIFIER_PATTERN.test(part))) {
    throw new Error(`字段或表名“${identifier}”格式无效。`)
  }
  if (databaseType === 'mysql' || databaseType === 'mariadb') return parts.map((part) => `\`${part}\``).join('.')
  if (databaseType === 'sqlserver') return parts.map((part) => `[${part}]`).join('.')
  return parts.map((part) => `"${part}"`).join('.')
}

function quoteValue(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildFunnelSql(config: FunnelConfig, databaseType: DatabaseType) {
  const steps = Array.from(new Set(config.steps.map((step) => step.trim()).filter(Boolean)))
  if (steps.length < 2) throw new Error('漏斗至少需要两个步骤。')
  if (steps.length > 12) throw new Error('漏斗最多支持 12 个步骤。')

  const table = quoteIdentifier(config.table, databaseType)
  const actorColumn = quoteIdentifier(config.actorColumn, databaseType)
  const eventColumn = quoteIdentifier(config.eventColumn, databaseType)
  const timeColumn = config.timeColumn?.trim() ? quoteIdentifier(config.timeColumn, databaseType) : null
  const conditions = [`${eventColumn} IN (${steps.map(quoteValue).join(', ')})`]
  if (config.startDate?.trim()) {
    if (!timeColumn) throw new Error('设置日期范围前，请先填写时间字段。')
    conditions.push(`${timeColumn} >= ${quoteValue(`${config.startDate.trim()} 00:00:00`)}`)
  }
  if (config.endDate?.trim()) {
    if (!timeColumn) throw new Error('设置日期范围前，请先填写时间字段。')
    conditions.push(`${timeColumn} <= ${quoteValue(`${config.endDate.trim()} 23:59:59`)}`)
  }
  const stepColumns = steps.map((step, index) => timeColumn
    ? `MIN(CASE WHEN ${eventColumn} = ${quoteValue(step)} THEN ${timeColumn} END) AS step_${index + 1}`
    : `MAX(CASE WHEN ${eventColumn} = ${quoteValue(step)} THEN 1 ELSE 0 END) AS step_${index + 1}`)
  const stageQueries = steps.map((step, index) => {
    const completedSteps = Array.from({ length: index + 1 }, (_, stepIndex) => timeColumn
      ? `step_${stepIndex + 1} IS NOT NULL${stepIndex > 0 ? ` AND step_${stepIndex + 1} >= step_${stepIndex}` : ''}`
      : `step_${stepIndex + 1} = 1`)
    return `SELECT ${quoteValue(step)} AS stage, COUNT(CASE WHEN ${completedSteps.join(' AND ')} THEN 1 END) AS users FROM actor_steps`
  })

  return [
    'WITH actor_steps AS (',
    `  SELECT ${actorColumn} AS actor_id,`,
    `    ${stepColumns.join(',\n    ')}`,
    `  FROM ${table}`,
    `  WHERE ${conditions.join('\n    AND ')}`,
    `  GROUP BY ${actorColumn}`,
    ')',
    `${stageQueries.join('\nUNION ALL\n')};`,
  ].join('\n')
}
