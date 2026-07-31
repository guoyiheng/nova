import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { buildDsn, changesSchemaSql, isWriteSql, sqliteDsnFromAbsolutePath } from './dbhub-utils.js'

describe('isWriteSql', () => {
  it('distinguishes result queries from database changes', () => {
    expect(isWriteSql('SELECT * FROM orders')).toBe(false)
    expect(isWriteSql('UPDATE orders SET status = 1')).toBe(true)
    expect(isWriteSql('WITH removed AS (DELETE FROM orders RETURNING *) SELECT * FROM removed')).toBe(true)
  })

  it('detects statements that invalidate the metadata cache', () => {
    expect(changesSchemaSql('ALTER TABLE orders ADD COLUMN note text')).toBe(true)
    expect(changesSchemaSql('UPDATE orders SET status = 1')).toBe(false)
  })
})

describe('buildDsn', () => {
  it('encodes credentials and applies the default PostgreSQL port', () => {
    expect(buildDsn({
      name: 'Primary',
      type: 'postgres',
      host: 'db.internal',
      database: 'sales data',
      username: 'nova@reader',
      sslMode: 'require',
    }, 'p@ss:word')).toBe('postgresql://nova%40reader:p%40ss%3Aword@db.internal:5432/sales%20data?sslmode=require')
  })

  it('builds an absolute SQLite DSN', () => {
    const databasePath = path.resolve('tmp', 'nova.db')
    const normalizedPath = databasePath.replace(/\\/g, '/')
    const expectedDsn = normalizedPath.startsWith('/') ? `sqlite://${normalizedPath}` : `sqlite:///${normalizedPath}`
    expect(buildDsn({ name: 'Local', type: 'sqlite', filePath: databasePath }, '')).toBe(expectedDsn)
  })

  it('normalizes Windows separators in SQLite DSNs', () => {
    expect(sqliteDsnFromAbsolutePath('D:\\data\\nova.db')).toBe('sqlite:///D:/data/nova.db')
  })
})
