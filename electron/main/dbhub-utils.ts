import path from 'node:path'
import type { DataSource, DataSourceInput } from '../shared/types.js'

export function isWriteSql(sql: string) {
  const normalized = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')
  return /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|replace|merge|call|execute|attach|detach|pragma|vacuum|rename|comment)\b/i.test(normalized)
}

export function changesSchemaSql(sql: string) {
  const normalized = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ' ')
  return /\b(create|alter|drop|truncate|rename|comment|attach|detach)\b/i.test(normalized)
}

function encode(value: string) {
  return encodeURIComponent(value)
}

export function sqliteDsnFromAbsolutePath(absolutePath: string): string {
  const normalizedPath = absolutePath.replace(/\\/g, '/')
  return normalizedPath.startsWith('/') ? `sqlite://${normalizedPath}` : `sqlite:///${normalizedPath}`
}

export function buildDsn(source: DataSource | DataSourceInput, password: string): string {
  if (source.type === 'demo') {
    const filePath = source.filePath?.trim()
    if (!filePath) throw new Error('演示数据库文件不可用。')
    return sqliteDsnFromAbsolutePath(path.resolve(filePath))
  }
  if (source.type === 'sqlite') {
    const filePath = source.filePath?.trim()
    if (!filePath) throw new Error('请选择 SQLite 数据库文件。')
    return sqliteDsnFromAbsolutePath(path.resolve(filePath))
  }

  const host = source.host?.trim()
  const database = source.database?.trim()
  const username = source.username?.trim()
  if (!host || !database || !username) throw new Error('请填写主机、数据库名称和用户名。')

  const defaults = { postgres: 5432, mysql: 3306, mariadb: 3306, sqlserver: 1433 }
  const port = source.port ?? defaults[source.type]
  const protocol = source.type === 'postgres' ? 'postgresql' : source.type
  const auth = `${encode(username)}:${encode(password)}@`
  const ssl = source.sslMode && source.sslMode !== 'prefer' ? `?sslmode=${encode(source.sslMode)}` : ''
  return `${protocol}://${auth}${host}:${port}/${encode(database)}${ssl}`
}
