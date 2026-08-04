import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { DEMO_DATABASE_VERSION, seedDemoDatabase } from './demo-database.js'

describe('seedDemoDatabase', () => {
  it('creates a coherent commerce dataset and can run repeatedly', () => {
    const db = new DatabaseSync(':memory:')
    try {
      const referenceDate = new Date('2026-08-04T08:00:00.000Z')
      expect(seedDemoDatabase(db, referenceDate)).toBe(true)
      expect(seedDemoDatabase(db, referenceDate)).toBe(false)

      expect((db.prepare('SELECT COUNT(*) AS count FROM customers').get() as { count: number }).count).toBe(36)
      expect((db.prepare('SELECT COUNT(*) AS count FROM orders').get() as { count: number }).count).toBe(144)
      expect((db.prepare("SELECT COUNT(DISTINCT visitor_id) AS count FROM funnel_events WHERE event_name = '完成购买'").get() as { count: number }).count).toBe(34)
      expect((db.prepare("SELECT value FROM nova_demo_meta WHERE key = 'version'").get() as { value: string }).value).toBe(String(DEMO_DATABASE_VERSION))

      const inconsistentOrders = db.prepare(`
        SELECT COUNT(*) AS count
        FROM orders o
        JOIN (SELECT order_id, SUM(quantity * unit_price) AS item_total FROM order_items GROUP BY order_id) i ON i.order_id = o.id
        WHERE o.total_amount != i.item_total
      `).get() as { count: number }
      expect(inconsistentOrders.count).toBe(0)

      db.prepare("UPDATE products SET name = '已修改' WHERE id = 1").run()
      db.exec('DROP TABLE nova_demo_meta')
      expect(seedDemoDatabase(db, referenceDate)).toBe(true)
      expect((db.prepare('SELECT name FROM products WHERE id = 1').get() as { name: string }).name).toBe('轻量通勤双肩包')
    } finally {
      db.close()
    }
  })
})
