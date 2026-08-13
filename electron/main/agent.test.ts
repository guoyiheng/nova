import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import {
  buildIntentGuidance,
  buildQueryPlanningGuidance,
  createModelClient,
  createProgressReporter,
  describeConnection,
  describeModelProgress,
  describeProgressError,
  describeQueryResult,
  describeSchema,
  expectsOverallAggregate,
  executeSqlTasks,
  formatAgentError,
  MAX_AGENT_MODEL_ROUNDS,
  overallAggregateNeedsCorrection,
  parseFinal,
  parseFunnelRecommendations,
  parseToolArguments,
  queryStepAction,
  shouldForceFinalAnswer,
  SYSTEM_PROMPT,
} from './agent.js'

describe('SYSTEM_PROMPT', () => {
  it('defines a compact Markdown contract inside strict JSON output', () => {
    expect(SYSTEM_PROMPT).toContain('最终响应只返回一个严格 JSON 对象')
    expect(SYSTEM_PROMPT).toContain('answer 字段使用简洁的 GFM Markdown')
    expect(SYSTEM_PROMPT).toContain('第一句直接回答问题')
    expect(SYSTEM_PROMPT).toContain('不使用任何标题、Markdown 表格')
    expect(SYSTEM_PROMPT).toContain('不要复述 SQL、查询过程或逐行复制数据表')
    expect(SYSTEM_PROMPT).toContain('可被 JSON.parse 直接解析')
    expect(SYSTEM_PROMPT).toContain('绝不能破坏外层 JSON')
    expect(SYSTEM_PROMPT).toContain('ID 只用于关联和定位，不能作为对象的唯一展示字段')
    expect(SYSTEM_PROMPT).toContain('必须通过现有字段或关联表同时返回名称或标题')
    expect(SYSTEM_PROMPT).toContain('按对象聚合时也要返回对象名称，不要只按 ID 分组')
    expect(SYSTEM_PROMPT).toContain('除非用户明确询问 ID，否则不要把内部 ID 当作主要结论')
    expect(SYSTEM_PROMPT).toContain('给出可展示的查询方向')
    expect(SYSTEM_PROMPT).toContain('自动从结构缓存识别事件表')
    expect(SYSTEM_PROMPT).toContain('不能把各事件独立计数冒充漏斗')
    expect(SYSTEM_PROMPT).toContain('SQL 总数不设固定上限')
    expect(SYSTEM_PROMPT).toContain('结果足以回答时立即输出最终 JSON')
    expect(SYSTEM_PROMPT).toContain('常规查询必须先根据高相关 Schema 确定大致查询方向')
    expect(SYSTEM_PROMPT).toContain('选定主表或视图、必要关联')
    expect(SYSTEM_PROMPT).toContain('并行查询明显更快时')
    expect(SYSTEM_PROMPT).toContain('这些 SQL 必须互不依赖且只读')
  })
})

describe('schema-first query planning', () => {
  it('requires common queries to identify the query direction before SQL', () => {
    const guidance = buildQueryPlanningGuidance('统计最近 30 天各地区订单金额')
    expect(guidance).toContain('先阅读按相关性排序的 Schema 详情')
    expect(guidance).toContain('主表或视图、必要关联')
    expect(guidance).toContain('指标字段、筛选字段、分组维度和时间字段')
    expect(guidance).toContain('JOIN、CTE 或条件聚合一次拿到目标字段')
    expect(guidance).toContain('多个结果互不依赖且并行更快')
    expect(guidance).toContain('数量按实际需要决定')
  })

  it('keeps funnel planning focused on event schema', () => {
    expect(buildQueryPlanningGuidance('分析注册到支付漏斗')).toContain('事件数据、用户标识、事件名称和时间字段')
  })
})

describe('SQL task scheduling', () => {
  it('starts independent read queries concurrently', async () => {
    const started: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve })
    const execution = executeSqlTasks([
      { sql: 'SELECT total FROM orders' },
      { sql: 'SELECT total FROM refunds' },
      { sql: 'SELECT total FROM credits' },
    ], async (task) => {
      started.push(task.sql)
      if (task.sql.includes('orders')) await firstBlocked
      return task.sql
    })

    await Promise.resolve()
    expect(started).toEqual(['SELECT total FROM orders', 'SELECT total FROM refunds', 'SELECT total FROM credits'])
    releaseFirst?.()
    await expect(execution).resolves.toEqual([
      { status: 'fulfilled', value: 'SELECT total FROM orders' },
      { status: 'fulfilled', value: 'SELECT total FROM refunds' },
      { status: 'fulfilled', value: 'SELECT total FROM credits' },
    ])
  })

  it('runs batches containing writes sequentially', async () => {
    const started: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve })
    const execution = executeSqlTasks([
      { sql: "UPDATE jobs SET status = 'done' WHERE id = 1" },
      { sql: 'SELECT status FROM jobs WHERE id = 1' },
    ], async (task) => {
      started.push(task.sql)
      if (task.sql.startsWith('UPDATE')) await firstBlocked
      return task.sql
    })

    await Promise.resolve()
    expect(started).toEqual(["UPDATE jobs SET status = 'done' WHERE id = 1"])
    releaseFirst?.()
    await execution
    expect(started).toEqual([
      "UPDATE jobs SET status = 'done' WHERE id = 1",
      'SELECT status FROM jobs WHERE id = 1',
    ])
  })
})

describe('query budget', () => {
  it('keeps the common path to one query and one answer round', () => {
    expect(shouldForceFinalAnswer(1)).toBe(false)
    expect(shouldForceFinalAnswer(2)).toBe(false)
  })

  it('forces an answer only at the final model round', () => {
    expect(MAX_AGENT_MODEL_ROUNDS).toBe(4)
    expect(shouldForceFinalAnswer(3)).toBe(false)
    expect(shouldForceFinalAnswer(MAX_AGENT_MODEL_ROUNDS)).toBe(true)
  })

  it('reuses duplicate SQL without limiting new SQL count', () => {
    expect(queryStepAction(' SELECT 1; ', ['SELECT 1'])).toBe('reuse')
    expect(queryStepAction('SELECT 3', ['SELECT 1', 'SELECT 2'])).toBe('execute')
  })
})

describe('funnel intent guidance', () => {
  it('guides smart queries to produce ordered distinct-user stages', () => {
    expect(buildIntentGuidance('分析注册到支付的漏斗并指出流失点')).toContain('stage 和 users')
  })
})

describe('progress details', () => {
  it('describes a database connection without credentials', () => {
    const detail = describeConnection({
      id: 'source-1',
      name: 'Analytics',
      type: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'analytics',
      username: 'reader',
      sslMode: 'require',
      filePath: '',
      status: 'connected',
      lastTestedAt: null,
      createdAt: '',
      updatedAt: '',
      hasPassword: true,
    })

    expect(detail).toContain('数据库类型：PostgreSQL')
    expect(detail).toContain('服务器：db.internal:5432')
    expect(detail).toContain('数据库：analytics')
    expect(detail).toContain('连接用户：reader')
    expect(detail).toContain('SSL 模式：require')
    expect(detail).not.toContain('密码')
  })

  it('summarizes schema metadata and query results', () => {
    const schema = JSON.stringify({ schemas: { public: {
      table: { results: [{ name: 'projects' }, { name: 'users' }] },
      column: { results: [{ name: 'id' }, { name: 'name' }] },
    } } })
    expect(describeSchema(schema, false)).toContain('数据库实时读取并写入本地缓存')
    expect(describeSchema(schema, false)).toContain('表 2 个，字段 2 个')
    expect(describeQueryResult({
      columns: ['project_name', 'status'],
      rows: [{ project_name: 'Nova', status: 'active' }],
      truncated: false,
    })).toBe('查询结果：返回 1 行\n结果字段（2 个）：project_name、status')
  })

  it('records the model plan, SQL, analysis basis and final conclusion', () => {
    const plan = describeModelProgress({
      stage: 'planning',
      model: 'gpt-5',
      round: 1,
      content: '查询项目名称、状态及负责人，并按名称筛选。',
      toolCalls: [{ type: 'function', function: {
        name: 'execute_sql',
        arguments: '{"sql":"SELECT name, status, owner FROM projects"}',
      } }],
      queryResult: null,
    })
    expect(plan).toContain('查询方向：查询项目名称、状态及负责人')
    expect(plan).toContain('查询计划：')
    expect(plan).toContain('SELECT name, status, owner FROM projects')

    const analysis = describeModelProgress({
      stage: 'answering',
      model: 'gpt-5',
      round: 2,
      content: null,
      queryResult: { columns: ['name'], rows: [{ name: 'Nova' }], truncated: false },
      finalAnswer: '查询到 **1 个**项目：Nova。',
    })
    expect(analysis).toContain('分析依据：返回 1 行')
    expect(analysis).toContain('分析结论：查询到 **1 个**项目：Nova。')
  })

  it('keeps the attempted action when a step fails', () => {
    expect(describeProgressError('服务器：db.internal:5432', '连接超时'))
      .toBe('服务器：db.internal:5432\n\n错误：连接超时')
  })
})

describe('parseFinal', () => {
  it('parses a valid JSON response', () => {
    expect(parseFinal('{"answer":"共 **2 个**项目。","chart":{"type":"none","xKey":"","yKey":"","title":""}}')).toEqual({
      answer: '共 **2 个**项目。',
      chart: { type: 'none', xKey: '', yKey: '', title: '' },
    })
  })

  it('recovers the answer when model output contains unescaped quotes and newlines', () => {
    const content = `{
  "answer": "查询到2个"人皇幡"相关项目：\n\n**项目1：贫道不好惹**\n- 总消耗积分：349,064 星币",
  "chart": {
    "type": "none",
    "xKey": "",
    "yKey": "",
    "title": ""
  }
}`

    expect(parseFinal(content)).toEqual({
      answer: '查询到2个"人皇幡"相关项目：\n\n**项目1：贫道不好惹**\n- 总消耗积分：349,064 星币',
      chart: null,
    })
  })
})

describe('parseFunnelRecommendations', () => {
  it('normalizes valid recommendations and hides malformed entries', () => {
    expect(parseFunnelRecommendations(JSON.stringify({ recommendations: [
      { name: '购买转化', description: '从访问到支付', steps: ['访问', '浏览', '浏览', '购买'], reason: '事件路径完整' },
      { name: '无效路径', steps: ['只有一步'] },
    ] }))).toEqual([{
      id: 'recommendation-1',
      name: '购买转化',
      description: '从访问到支付',
      steps: ['访问', '浏览', '购买'],
      reason: '事件路径完整',
    }])
  })

  it('accepts fenced JSON and limits the result count', () => {
    const recommendations = Array.from({ length: 6 }, (_, index) => ({
      name: `路径 ${index + 1}`,
      steps: ['开始', '完成'],
    }))
    expect(parseFunnelRecommendations(`\`\`\`json\n${JSON.stringify({ recommendations })}\n\`\`\``)).toHaveLength(4)
  })
})

describe('createModelClient', () => {
  it('sends no authorization header when the channel has no API key', async () => {
    let authorization: string | undefined
    const server = createServer((request, response) => {
      authorization = request.headers.authorization
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({
        id: 'completion-1',
        object: 'chat.completion',
        created: 0,
        model: 'local-model',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务未启动。')

    try {
      const client = createModelClient('', `http://127.0.0.1:${address.port}/v1`)
      await client.chat.completions.create({ model: 'local-model', messages: [] })
      expect(authorization).toBeUndefined()
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})

describe('createProgressReporter', () => {
  it('keeps concurrent query progress correlated to its query id', () => {
    const events: Array<{ queryId?: string; status: string }> = []
    const first = createProgressReporter('query-123', (event) => events.push(event))
    const second = createProgressReporter('query-456', (event) => events.push(event))
    first('planning', '生成查询计划', '准备中').success('已完成')
    second('planning', '生成查询计划', '准备中').success('已完成')

    expect(events).toHaveLength(4)
    expect(events.filter((event) => event.queryId === 'query-123')).toHaveLength(2)
    expect(events.filter((event) => event.queryId === 'query-456')).toHaveLength(2)
    expect(events.map((event) => event.status)).toEqual(['running', 'success', 'running', 'success'])
  })

  it('attaches a query result to the completed query step', () => {
    const events: Parameters<Parameters<typeof createProgressReporter>[1]>[0][] = []
    const report = createProgressReporter('query-123', (event) => events.push(event))
    const queryResult = { columns: ['name'], rows: [{ name: 'Nova' }], truncated: false }

    report('querying', '执行 SQL', 'SELECT name FROM projects').success('SELECT name FROM projects', queryResult)

    expect(events[1]?.queryResult).toEqual(queryResult)
  })
})

describe('parseToolArguments', () => {
  it('accepts strict execute_sql arguments', () => {
    expect(parseToolArguments('execute_sql', '{"sql":"SELECT 1"}')).toEqual({ sql: 'SELECT 1' })
  })

  it('accepts string and provider alias arguments', () => {
    expect(parseToolArguments('execute_sql', '"SELECT 1"')).toEqual({ sql: 'SELECT 1' })
    expect(parseToolArguments('execute_sql', '{"query":"WITH totals AS (SELECT 1) SELECT * FROM totals"}')).toEqual({
      sql: 'WITH totals AS (SELECT 1) SELECT * FROM totals',
    })
  })

  it('recovers fenced SQL and loosely serialized multiline SQL', () => {
    expect(parseToolArguments('execute_sql', '```sql\nSELECT * FROM usage\n```')).toEqual({ sql: 'SELECT * FROM usage' })
    expect(parseToolArguments('execute_sql', '{"sql":"SELECT model,\nCOUNT(*) FROM usage GROUP BY model"}')).toEqual({
      sql: 'SELECT model,\nCOUNT(*) FROM usage GROUP BY model',
    })
  })

  it('accepts write SQL and rejects missing SQL arguments', () => {
    expect(parseToolArguments('execute_sql', '{"sql":"DELETE FROM usage WHERE expired = true"}')).toEqual({
      sql: 'DELETE FROM usage WHERE expired = true',
    })
    expect(() => parseToolArguments('execute_sql', '{}')).toThrow('无效的 execute_sql 参数')
  })
})

describe('formatAgentError', () => {
  it('keeps provider status and request details', () => {
    const error = Object.assign(new Error('Bad request'), { status: 400, code: 'invalid_request', request_id: 'req_123' })
    expect(formatAgentError(error)).toBe('模型服务请求失败（HTTP 400）：Bad request（代码 invalid_request，请求 req_123）')
  })
})

describe('query intent safeguards', () => {
  it('treats an unqualified count request as one overall aggregate', () => {
    expect(expectsOverallAggregate('查看生图模型的次数')).toBe(true)
    expect(expectsOverallAggregate('最近一周一共有多少次生图调用')).toBe(true)
    expect(expectsOverallAggregate('生图模型有多少')).toBe(true)
    expect(expectsOverallAggregate('查看生图模型调用量')).toBe(true)
    expect(buildIntentGuidance('查看生图模型的次数')).toContain('最终查询返回一行总计')
  })

  it('preserves explicit breakdown and trend requests', () => {
    expect(expectsOverallAggregate('查看各生图模型的次数')).toBe(false)
    expect(expectsOverallAggregate('查看不同生图类型的调用次数')).toBe(false)
    expect(expectsOverallAggregate('按天查看生图模型次数趋势')).toBe(false)
    expect(expectsOverallAggregate('查看生图模型按天的调用次数')).toBe(false)
    expect(expectsOverallAggregate('查看每种生图模型的用量')).toBe(false)
    expect(expectsOverallAggregate('生图模型调用次数排行')).toBe(false)
  })

  it('requires an overall-count query to finish with one result row', () => {
    const grouped = {
      columns: ['model', 'count'],
      rows: [{ model: 'A', count: 3 }, { model: 'B', count: 4 }],
      truncated: false,
    }
    const total = {
      columns: ['count'],
      rows: [{ count: 7 }],
      truncated: false,
    }

    expect(overallAggregateNeedsCorrection('查看生图模型的次数', 'SELECT model, COUNT(*) FROM usage GROUP BY model', grouped)).toBe(true)
    expect(overallAggregateNeedsCorrection('查看生图模型的次数', 'SELECT COUNT(*) AS count FROM usage', total)).toBe(false)
    expect(overallAggregateNeedsCorrection('查看各生图模型的次数', 'SELECT model, COUNT(*) FROM usage GROUP BY model', grouped)).toBe(false)
  })
})
