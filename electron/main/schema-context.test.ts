import { describe, expect, it } from 'vitest'
import { buildSchemaContext } from './schema-context.js'

function relation(name: string, columns: Array<{ name: string; type: string }>, comment = '') {
  return { name, comment, columns: columns.map((column) => ({ ...column, nullable: false })) }
}

describe('schema context selection', () => {
  it('prioritizes relations matching the question instead of truncating the raw cache prefix', () => {
    const schemaJson = JSON.stringify({
      capturedAt: '2026-08-03T10:00:00.000Z',
      schemas: {
        public: {
          table: { results: [
            relation('audit_archive', [{ name: 'payload', type: 'text' }], 'x'.repeat(20_000)),
            relation('orders', [{ name: 'customer_id', type: 'uuid' }, { name: 'total_amount', type: 'decimal' }], '客户订单'),
          ] },
          view: { results: [] },
        },
      },
    })

    const context = buildSchemaContext(schemaJson, '统计客户订单总金额', 2_000)
    const parsed = JSON.parse(context) as { relations: Array<{ name: string }> }
    expect(parsed.relations[0]?.name).toBe('orders')
    expect(context).toContain('total_amount')
    expect(context).not.toContain('x'.repeat(100))
  })

  it('keeps a compact global catalog and respects the context budget', () => {
    const tables = Array.from({ length: 200 }, (_, index) => relation(
      `table_${index}`,
      Array.from({ length: 20 }, (__, columnIndex) => ({ name: `column_${columnIndex}`, type: 'varchar' })),
    ))
    const context = buildSchemaContext(JSON.stringify({
      schemas: { public: { table: { results: tables }, view: { results: [] } } },
    }), '查看 table_199', 5_000)
    const parsed = JSON.parse(context) as {
      totalRelations: number
      catalog: string[]
      relations: Array<{ name: string }>
      omittedRelationDetails: number
    }

    expect(context.length).toBeLessThanOrEqual(5_000)
    expect(parsed.totalRelations).toBe(200)
    expect(parsed.catalog[0]).toContain('table_199')
    expect(parsed.relations[0]?.name).toBe('table_199')
    expect(parsed.omittedRelationDetails).toBeGreaterThan(0)
  })
})
