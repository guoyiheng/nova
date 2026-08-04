import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { seedDemoDatabase } from '../electron/main/demo-database.js'
import { buildFunnelSql, parseFunnelSteps } from './funnel'

describe('parseFunnelSteps', () => {
  it('normalizes lines and removes duplicate steps', () => {
    expect(parseFunnelSteps('访问\n浏览，浏览,购买')).toEqual(['访问', '浏览', '购买'])
  })
})

describe('buildFunnelSql', () => {
  it('builds an ordered SQLite funnel query', () => {
    const sql = buildFunnelSql({
      table: 'funnel_events',
      actorColumn: 'visitor_id',
      eventColumn: 'event_name',
      timeColumn: 'occurred_at',
      startDate: '2026-07-01',
      steps: ['访问网站', '完成购买'],
    }, 'demo')
    expect(sql).toContain('"visitor_id" AS actor_id')
    expect(sql).toContain('"occurred_at" >= \'2026-07-01 00:00:00\'')
    expect(sql).toContain("SELECT '完成购买' AS stage")
    expect(sql).toContain('step_2 >= step_1')
  })

  it('uses the database identifier style and rejects unsafe names', () => {
    expect(buildFunnelSql({ table: 'analytics.events', actorColumn: 'user_id', eventColumn: 'event', steps: ['a', 'b'] }, 'mysql'))
      .toContain('FROM `analytics`.`events`')
    expect(() => buildFunnelSql({ table: 'events; DROP TABLE users', actorColumn: 'user_id', eventColumn: 'event', steps: ['a', 'b'] }, 'postgres'))
      .toThrow('格式无效')
  })

  it('returns the expected conversion chain from the built-in demo database', () => {
    const db = new DatabaseSync(':memory:')
    try {
      seedDemoDatabase(db, new Date('2026-08-04T08:00:00.000Z'))
      const sql = buildFunnelSql({
        table: 'funnel_events',
        actorColumn: 'visitor_id',
        eventColumn: 'event_name',
        steps: ['访问网站', '浏览商品', '加入购物车', '开始结算', '完成购买'],
      }, 'demo')
      const rows = db.prepare(sql).all() as unknown as Array<{ stage: string; users: number }>
      expect(rows.map((row) => [row.stage, row.users])).toEqual([
        ['访问网站', 120],
        ['浏览商品', 102],
        ['加入购物车', 72],
        ['开始结算', 48],
        ['完成购买', 34],
      ])
    } finally {
      db.close()
    }
  })
})
