import { describe, expect, it } from 'vitest'

import { parseDataSourceUrl } from './data-source-url'

describe('parseDataSourceUrl', () => {
  it('parses and decodes a MySQL connection URL', () => {
    expect(parseDataSourceUrl('mysql://demo:p%40ss%23word@db.internal:3306/sample')).toEqual({
      type: 'mysql',
      host: 'db.internal',
      port: 3306,
      database: 'sample',
      username: 'demo',
      password: 'p@ss#word',
      sslMode: 'prefer',
      filePath: '',
    })
  })

  it('supports PostgreSQL aliases, default ports and SSL options', () => {
    expect(parseDataSourceUrl('postgresql://report%40user:secret@db.internal/weekly%20report?sslmode=require')).toMatchObject({
      type: 'postgres',
      host: 'db.internal',
      port: 5432,
      database: 'weekly report',
      username: 'report@user',
      password: 'secret',
      sslMode: 'require',
    })
  })

  it('rejects unsupported and malformed connection URLs', () => {
    expect(() => parseDataSourceUrl('redis://localhost:6379/0')).toThrow('暂不支持该连接串类型')
    expect(() => parseDataSourceUrl('not a url')).toThrow('无法识别连接串')
  })
})
