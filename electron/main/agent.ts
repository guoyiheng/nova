import OpenAI from 'openai'
import type { ChatCompletionFunctionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { AgentProgressEvent, AgentStage, ChartSpec, DataSource, QueryTable } from '../shared/types.js'
import { DbhubSession, loadSchemaSnapshot, parseQueryTable, toolResultText } from './dbhub.js'
import { buildDsn, changesSchemaSql } from './dbhub-utils.js'
import { resolveSchemaSnapshot } from './schema-cache.js'
import { buildSchemaContext } from './schema-context.js'

export const SYSTEM_PROMPT = `你是 Nova 的数据分析 Agent。你通过 DBHub 查询当前数据库，并用中文给出准确、简洁的结论。

规则：
1. 数据库结构上下文包含按当前问题筛选的表、视图和字段详情，以及全局对象目录。必须优先基于这些信息规划 SQL；目录中有候选对象但缺少字段详情时，先用当前数据库适配的元数据查询确认字段，不要猜测对象名称。
2. 默认使用查询语句回答分析问题。只有用户明确要求修改数据库时，才执行写入或 DDL；不要自行扩大修改范围。
3. 查询前先识别用户要求的目标指标、筛选对象、统计范围、分组维度和时间范围。筛选对象不是分组维度，不得添加用户未要求的拆分维度。
4. “X 的次数 / 数量 / 总数 / 多少”默认表示满足 X 条件的总体统计，最终查询应返回单一总计。只有用户明确使用“各、每个、分别、按、分布、占比、排行、趋势、对比”等表达时才分组。
5. 例如："查看X的次数"应筛选X后统计总体次数，不按类型分组；"查看各X的次数"才按类型分组；"按天查看X次数趋势"才按日期分组。
6. 可以先查询候选字段或分类值以确认筛选条件，但最后一次查询必须直接回答原问题。回答前核对统计指标、筛选范围、分组维度与用户原意一致。
7. 查询项目、用户、组织、订单、商品等业务对象时，结果必须让人能直接识别对象：ID 只用于关联和定位，不能作为对象的唯一展示字段；必须通过现有字段或关联表同时返回名称或标题，并按问题补充状态、类型、负责人、时间等最相关的少量上下文字段。按对象聚合时也要返回对象名称，不要只按 ID 分组。只有数据库中确实没有可读字段时，才单独返回 ID。
8. 最终结论使用名称或标题指代业务对象；除非用户明确询问 ID，否则不要把内部 ID 当作主要结论。字段含义不明确时，结合表结构和关联关系确认含义后再回答。
9. 优先聚合数据，不查询与问题无关的明细或敏感字段。执行修改时应使用范围明确的条件。
10. SQL 须适配当前数据库类型，不适配的话自己转成对应的数据库语法。
11. 每次调用 execute_sql 前，在 assistant content 中用一至两句话给出可展示的步骤说明：说明本轮要查询或验证的对象、指标、筛选条件和必要关联；只描述行动计划和依据，不输出冗长推理。
12. 最终响应只返回一个严格 JSON 对象，且必须可被 JSON.parse 直接解析；不要添加解释、前后缀或 Markdown 代码块。JSON 结构必须是：{"answer":"结论","chart":{"type":"bar|line|pie|radar|scatter|bubble|heatmap|none","xKey":"字段","yKey":"字段","title":"标题"}}。answer 内出现引号时优先使用中文引号；必须使用英文双引号时写成 \\"，换行必须写成 \\n，绝不能破坏外层 JSON。
13. answer 字段使用简洁的 GFM Markdown：第一句直接回答问题；只在关键指标、数值或结论上使用 **加粗**；存在多个并列发现时才使用无序列表；字段名或短代码可使用行内代码。
14. answer 不使用任何标题、Markdown 表格、引用块、分隔线、代码块或 HTML；不要复述 SQL、查询过程或逐行复制数据表；不要使用“根据查询结果”“分析如下”等空泛开场。
15. answer 中的数字、单位、时间范围和比较口径必须明确且来自最后一次查询结果。没有匹配数据时直接说明未查到符合条件的数据，并简要指出主要筛选范围，不得编造原因或趋势。
16. 没有适合的图表时使用 none。图表字段必须来自最后一次查询结果。
17. 调用 execute_sql 时，参数必须是严格 JSON 对象：{"sql":"..."}。不要把 SQL 直接作为参数字符串，也不要使用 Markdown 代码块。

合格的 answer 示例："最近 30 天订单总数为 **1,284 笔**。\\n\\n- 已完成：**1,201 笔**\\n- 已取消：**83 笔**"。`

const COUNT_INTENT_PATTERN = /次数|多少|数量|个数|记录数|总数|总量|调用量|使用量|用量|一共|共计|count/iu
const BREAKDOWN_INTENT_PATTERN = /分别|各(?:个|类|种|项)?|每(?:天|日|周|月|年|小时|分钟|个|类|种|项)|分布|占比|排行|排名|趋势|对比|比较|明细|列表|按.{0,12}(?:次数|数量|用量|统计|汇总|分组|展示|查看|趋势)|按(?:天|日|周|月|年|小时|分钟|模型|类型|渠道|状态|用户|地区)|不同.{0,16}(?:次数|数量|总数|多少|用量)/u

export function expectsOverallAggregate(question: string) {
  return COUNT_INTENT_PATTERN.test(question) && !BREAKDOWN_INTENT_PATTERN.test(question)
}

export function buildIntentGuidance(question: string) {
  if (expectsOverallAggregate(question)) {
    return '该问题要求总体次数或总量。把问题中的对象作为筛选条件，最终查询返回一行总计；不要按对象的类型、名称或其他未明确要求的维度分组。若先探索分类值，探索后仍需执行最终总计查询。'
  }
  return '严格按照用户明确提出的维度组织结果；不要自行增加类型、时间或其他分组维度。'
}

export function overallAggregateNeedsCorrection(question: string, sql: string, table: QueryTable | null) {
  if (!expectsOverallAggregate(question)) return false
  return !sql.trim() || !table || table.affectedRows !== undefined || table.rows.length !== 1
}

const DATABASE_TYPE_LABELS: Record<DataSource['type'], string> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  sqlserver: 'SQL Server',
  sqlite: 'SQLite',
  demo: '演示数据库（内存 SQLite）',
}

export function describeConnection(source: DataSource) {
  const lines = [`数据源：${source.name}`, `数据库类型：${DATABASE_TYPE_LABELS[source.type]}`]
  if (source.type === 'sqlite') lines.push(`数据库文件：${source.filePath}`)
  else if (source.type !== 'demo') {
    lines.push(`服务器：${source.host}:${source.port ?? '默认端口'}`)
    lines.push(`数据库：${source.database}`)
    lines.push(`连接用户：${source.username}`)
    lines.push(`SSL 模式：${source.sslMode || 'prefer'}`)
  }
  return lines.join('\n')
}

export function describeQueryResult(table: QueryTable) {
  if (table.affectedRows !== undefined) return `执行结果：影响 ${table.affectedRows} 行`
  const rowCount = `${table.rows.length}${table.truncated ? '+' : ''}`
  const columns = table.columns.length ? table.columns.join('、') : '无'
  return `查询结果：返回 ${rowCount} 行\n结果字段（${table.columns.length} 个）：${columns}`
}

export function describeSchema(schemaJson: string, fromCache: boolean) {
  const counts: Record<string, number> = {}
  try {
    const parsed = JSON.parse(schemaJson) as { schemas?: Record<string, Record<string, { results?: unknown[] }>> }
    for (const schema of Object.values(parsed.schemas ?? {})) {
      for (const [type, value] of Object.entries(schema)) {
        if (Array.isArray(value?.results)) counts[type] = (counts[type] ?? 0) + value.results.length
      }
    }
  } catch {
    // Size information below remains available for older cache formats.
  }
  const labels: Record<string, string> = { table: '表', view: '视图', column: '字段', procedure: '存储过程', function: '函数', index: '索引' }
  const objectSummary = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${labels[type] ?? type} ${count} 个`)
    .join('，')
  return [
    `元数据来源：${fromCache ? '本地缓存' : '数据库实时读取并写入本地缓存'}`,
    `缓存大小：${Math.ceil(schemaJson.length / 1024)} KB`,
    ...(objectSummary ? [`数据库对象：${objectSummary}`] : []),
  ].join('\n')
}

type ProgressToolCall = {
  type: string
  function: { name: string; arguments: string }
}

export function describeModelProgress(options: {
  stage: AgentStage
  model: string
  round: number
  content: string | null | undefined
  toolCalls?: ProgressToolCall[]
  queryResult: QueryTable | null
  finalAnswer?: string
}) {
  const { stage, model, round, content, toolCalls = [], queryResult, finalAnswer } = options
  const lines = [`模型：${model}`, `分析轮次：第 ${round} 轮`]
  if (queryResult) lines.push(`分析依据：${describeQueryResult(queryResult).replace('查询结果：', '')}`)

  const summary = content?.trim()
  if (toolCalls.length) {
    if (summary) lines.push(`步骤说明：${summary}`)
    lines.push(stage === 'planning' ? '查询计划：' : '下一步查询：')
    toolCalls.forEach((toolCall, index) => {
      let sql = ''
      try {
        sql = String(parseToolArguments(toolCall.function.name, toolCall.function.arguments).sql ?? '')
      } catch {
        sql = toolCall.function.arguments
      }
      lines.push(`${index + 1}. ${toolCall.function.name}${sql ? `\n${sql}` : ''}`)
    })
  } else {
    lines.push(`分析结论：${finalAnswer ?? summary ?? '已完成结果分析'}`)
  }
  return lines.join('\n')
}

export function describeProgressError(detail: string, errorDetail: string) {
  return `${detail}\n\n错误：${errorDetail}`
}

type AgentResult = {
  answer: string
  sql: string
  table: QueryTable | null
  chart: ChartSpec | null
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

function parseLooseAnswer(content: string) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const match = cleaned.match(/^\s*\{\s*"answer"\s*:\s*"([\s\S]*)"\s*,\s*"chart"\s*:/)
  if (!match) return null

  return match[1]
    .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

export function parseFinal(content: string): { answer: string; chart: ChartSpec | null } {
  const parsed = parseJsonObject(content)
  if (!parsed) {
    const looseAnswer = parseLooseAnswer(content)
    return { answer: looseAnswer ?? (content || '查询已完成。'), chart: null }
  }
  const chart = parsed.chart as Partial<ChartSpec> | undefined
  const allowed = new Set(['bar', 'line', 'pie', 'radar', 'scatter', 'bubble', 'heatmap', 'none'])
  return {
    answer: typeof parsed.answer === 'string' ? parsed.answer : '查询已完成。',
    chart: chart && typeof chart.type === 'string' && allowed.has(chart.type)
      ? {
          type: chart.type as ChartSpec['type'],
          xKey: typeof chart.xKey === 'string' ? chart.xKey : undefined,
          yKey: typeof chart.yKey === 'string' ? chart.yKey : undefined,
          title: typeof chart.title === 'string' ? chart.title : undefined,
        }
      : null,
  }
}

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json|sql)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function looksLikeSqlStatement(value: string) {
  return /^(select|with|explain|insert|update|delete|drop|alter|truncate|create|grant|revoke|replace|merge|call|execute|attach|detach|pragma|vacuum|rename|comment|begin|commit|rollback|set|use|show|describe|desc)\b/i.test(value.trim())
}

export function parseToolArguments(toolName: string, rawArguments: string): Record<string, unknown> {
  const cleaned = stripCodeFence(rawArguments)
  let parsed: unknown

  const candidates = [cleaned]
  const objectStart = cleaned.indexOf('{')
  const objectEnd = cleaned.lastIndexOf('}')
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(cleaned.slice(objectStart, objectEnd + 1))

  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate)
      break
    } catch {
      // Compatibility fallbacks below handle providers that serialize tool arguments loosely.
    }
  }

  if (toolName !== 'execute_sql') {
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    throw new Error(`模型生成了无效的 ${toolName} 参数。`)
  }

  if (typeof parsed === 'string' && parsed.trim()) return { sql: parsed.trim() }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const object = parsed as Record<string, unknown>
    const sql = [object.sql, object.query, object.statement].find((value) => typeof value === 'string')
    if (typeof sql === 'string' && sql.trim()) return { sql: sql.trim() }
  }
  if (looksLikeSqlStatement(cleaned)) return { sql: cleaned }

  const looseSql = cleaned.match(/(?:["']?(?:sql|query|statement)["']?)\s*[:=]\s*([\s\S]+)/i)?.[1]
    ?.replace(/^\s*["']/, '')
    .replace(/["']?\s*}\s*$/, '')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .trim()
  if (looseSql && looksLikeSqlStatement(looseSql)) return { sql: looseSql }

  throw new Error('模型生成了无效的 execute_sql 参数，请重试。')
}

export function formatAgentError(error: unknown) {
  if (!(error instanceof Error)) return '查询失败，请稍后重试。'
  const details = error as Error & {
    status?: number
    code?: string
    request_id?: string
    error?: { message?: string; code?: string; type?: string }
  }
  const status = details.status ? `HTTP ${details.status}` : ''
  const providerMessage = details.error?.message && details.error.message !== details.message
    ? details.error.message
    : details.message
  const code = details.error?.code ?? details.code
  const suffix = [code ? `代码 ${code}` : '', details.request_id ? `请求 ${details.request_id}` : ''].filter(Boolean).join('，')
  if (!status) return providerMessage
  return `模型服务请求失败（${status}）：${providerMessage}${suffix ? `（${suffix}）` : ''}`
}

export function createProgressReporter(queryId: string, onProgress: (progress: AgentProgressEvent) => void) {
  let sequence = 0
  return (stage: AgentStage, title: string, detail: string) => {
    const id = `${stage}-${sequence += 1}`
    const startedAt = Date.now()
    onProgress({ id, queryId, stage, title, detail, status: 'running', elapsedMs: 0 })
    return {
      success(nextDetail = detail, queryResult?: QueryTable) {
        onProgress({ id, queryId, stage, title, detail: nextDetail, queryResult, status: 'success', elapsedMs: Date.now() - startedAt })
      },
      error(errorDetail: string) {
        onProgress({ id, queryId, stage, title, detail: describeProgressError(detail, errorDetail), status: 'error', elapsedMs: Date.now() - startedAt })
      },
    }
  }
}

export function createModelClient(apiKey: string, baseUrl: string) {
  return new OpenAI({
    apiKey,
    baseURL: baseUrl,
    ...(apiKey ? {} : { defaultHeaders: { Authorization: null } }),
  })
}

export async function runAgent(options: {
  queryId: string
  question: string
  source: DataSource
  password: string
  apiKey: string
  baseUrl: string
  model: string
  schemaCache: string | null
  schemaCacheNeedsRefresh: boolean
  onSchemaLoaded: (schemaJson: string) => void | Promise<void>
  onSchemaChanged: () => void | Promise<void>
  onProgress: (progress: AgentProgressEvent) => void
}): Promise<AgentResult> {
  const { queryId, question, source, password, apiKey, baseUrl, model, schemaCache, schemaCacheNeedsRefresh, onSchemaLoaded, onSchemaChanged, onProgress } = options
  const session = new DbhubSession()
  const progress = createProgressReporter(queryId, onProgress)
  let lastSql = ''
  let lastTable: QueryTable | null = null

  try {
    const connectionDetail = describeConnection(source)
    const connectionStep = progress('schema', '连接数据库', `${connectionDetail}\n状态：正在建立连接`)
    let listed: Awaited<ReturnType<DbhubSession['connect']>>
    try {
      listed = await session.connect(buildDsn(source, password))
      connectionStep.success(`${connectionDetail}\n状态：连接成功，已确认 SQL 执行能力`)
    } catch (error) {
      connectionStep.error(error instanceof Error ? error.message : '数据库连接失败')
      throw error
    }
    const executeTools = listed.tools.filter((tool) => tool.name === 'execute_sql')
    if (!executeTools.length) throw new Error('DBHub 未提供 SQL 执行工具。')
    const tools: ChatCompletionFunctionTool[] = executeTools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: {
            sql: { type: 'string', description: '要执行的 SQL，必须符合当前数据库语法' },
          },
          required: ['sql'],
          additionalProperties: false,
        },
      },
    }))
    const schemaStep = progress(
      'schema',
      schemaCacheNeedsRefresh ? '更新元数据缓存' : schemaCache ? '读取元数据缓存' : '缓存数据库结构',
      schemaCacheNeedsRefresh ? '缓存已超过 24 小时，正在从数据库重新读取结构' : schemaCache ? '正在读取本地数据库结构缓存' : '正在从数据库读取 Schema、表、视图、字段、函数和索引',
    )
    let schemaJson: string
    try {
      const resolved = await resolveSchemaSnapshot({
        cachedSchema: schemaCache,
        needsRefresh: schemaCacheNeedsRefresh,
        loadFresh: () => loadSchemaSnapshot(session),
        saveFresh: onSchemaLoaded,
      })
      schemaJson = resolved.schemaJson
      schemaStep.success([
        describeSchema(schemaJson, resolved.source !== 'fresh'),
        ...(resolved.source === 'stale-fallback' ? ['缓存更新失败，本次继续使用已有结构'] : []),
      ].join('\n'))
    } catch (error) {
      schemaStep.error(error instanceof Error ? error.message : '数据库结构读取失败')
      throw error
    }
    const schemaContext = buildSchemaContext(schemaJson, question)

    const client = createModelClient(apiKey, baseUrl)
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `当前数据库类型：${source.type}\n数据库结构缓存：\n${schemaContext}\n\n意图约束：${buildIntentGuidance(question)}\n\n问题：${question}` },
    ]

    for (let step = 0; step < 6; step += 1) {
      const stage = step === 0 ? 'planning' : 'answering'
      const modelStep = progress(
        stage,
        step === 0 ? '生成查询计划' : '分析查询结果',
        [
          `模型：${model}`,
          `分析轮次：第 ${step + 1} 轮`,
          step === 0 ? `待回答问题：${question}` : lastTable ? `正在分析上一查询结果\n${describeQueryResult(lastTable)}` : '正在分析数据库返回内容',
        ].join('\n'),
      )
      let completion: Awaited<ReturnType<typeof client.chat.completions.create>>
      try {
        completion = await client.chat.completions.create({
          model,
          messages,
          tools,
          tool_choice: 'auto',
        })
      } catch (error) {
        const message = formatAgentError(error)
        modelStep.error(message)
        throw new Error(message)
      }
      const message = completion.choices[0]?.message
      if (!message) {
        modelStep.error('模型没有返回查询计划或分析内容。')
        throw new Error('模型没有返回内容。')
      }
      messages.push(message)
      const functionToolCalls = message.tool_calls?.filter((toolCall) => toolCall.type === 'function') ?? []

      if (!message.tool_calls?.length) {
        const final = parseFinal(message.content ?? '')
        modelStep.success(describeModelProgress({
          stage,
          model,
          round: step + 1,
          content: message.content,
          queryResult: lastTable,
          finalAnswer: final.answer,
        }), lastTable ?? undefined)
        if (overallAggregateNeedsCorrection(question, lastSql, lastTable)) {
          const intentStep = progress('planning', '校验统计口径', '确认查询结果是否直接回答原问题')
          intentStep.success([
            '校验结果：当前结果没有直接返回用户要求的单一总计',
            lastTable ? describeQueryResult(lastTable) : '查询结果：尚无可用结果',
            '处理方式：保留原筛选条件，移除未要求的分组维度并重新查询',
          ].join('\n'), lastTable ?? undefined)
          messages.push({
            role: 'user',
            content: '当前结果没有直接给出用户要求的总体次数。请重新调用 execute_sql：保留原问题中的筛选条件，移除未明确要求的分组维度，并让最终查询只返回一行总计结果。不要直接解释当前多行结果。',
          })
          continue
        }
        return { ...final, sql: lastSql, table: lastTable }
      }

      modelStep.success(describeModelProgress({
        stage,
        model,
        round: step + 1,
        content: message.content,
        toolCalls: functionToolCalls,
        queryResult: lastTable,
      }), lastTable ?? undefined)

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') continue
        let args: Record<string, unknown>
        try {
          args = parseToolArguments(toolCall.function.name, toolCall.function.arguments)
        } catch (error) {
          const detail = error instanceof Error ? error.message : `模型生成了无效的 ${toolCall.function.name} 参数。`
          const argumentStep = progress('planning', '校验查询参数', '检查模型生成的工具参数')
          argumentStep.success(`${detail} 已要求模型按严格 JSON 重新生成`)
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: '工具参数格式无效。请重新调用 execute_sql，并只传入严格 JSON 对象：{"sql":"..."}。',
          })
          continue
        }
        const sql = toolCall.function.name === 'execute_sql' ? String(args.sql ?? '') : ''
        const queryStep = progress('querying', '执行 SQL', sql ? `准备执行：\n${sql}` : `准备调用：${toolCall.function.name}`)
        let result: Awaited<ReturnType<DbhubSession['callTool']>>
        try {
          result = await session.callTool(toolCall.function.name, args)
        } catch (error) {
          queryStep.error(error instanceof Error ? error.message : '查询执行失败')
          throw error
        }
        const fullText = toolResultText(result)
        if (toolCall.function.name === 'execute_sql') {
          lastSql = String(args.sql ?? '')
          if (changesSchemaSql(lastSql)) await onSchemaChanged()
          try {
            lastTable = parseQueryTable(result, lastSql)
          } catch {
            lastTable = null
          }
        }
        queryStep.success([
          `SQL：\n${sql}`,
          lastTable ? describeQueryResult(lastTable) : '执行结果：数据库未返回可展示的表格数据',
        ].join('\n\n'), lastTable ?? undefined)
        const modelText = fullText.length > 60_000 ? `${fullText.slice(0, 60_000)}\n[结果已截断]` : fullText
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: modelText,
        })
      }
    }
    throw new Error('Agent 超过了最大查询步骤，请缩小问题范围后重试。')
  } finally {
    await session.close()
  }
}
