import { describe, expect, it } from 'vitest'
import type { SavedSql } from '../electron/shared/types'
import { savedSqlForSource } from './app-helpers'

const savedSql: SavedSql[] = [
  { id: 'orders-a', dataSourceId: 'source-a', name: 'Orders', sql: 'SELECT * FROM orders', createdAt: '', updatedAt: '' },
  { id: 'users-a', dataSourceId: 'source-a', name: 'Users', sql: 'SELECT * FROM users', createdAt: '', updatedAt: '' },
  { id: 'orders-b', dataSourceId: 'source-b', name: 'Orders', sql: 'SELECT count(*) FROM orders', createdAt: '', updatedAt: '' },
]

describe('savedSqlForSource', () => {
  it('only returns SQL saved for the selected data source', () => {
    expect(savedSqlForSource(savedSql, 'source-a').map((item) => item.id)).toEqual(['orders-a', 'users-a'])
    expect(savedSqlForSource(savedSql, 'source-b').map((item) => item.id)).toEqual(['orders-b'])
  })

  it('searches within the selected data source', () => {
    expect(savedSqlForSource(savedSql, 'source-a', 'orders').map((item) => item.id)).toEqual(['orders-a'])
    expect(savedSqlForSource(savedSql, 'source-a', 'count')).toEqual([])
  })
})
