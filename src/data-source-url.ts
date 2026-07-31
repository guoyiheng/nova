import type { DataSourceInput, DatabaseType } from '../electron/shared/types'

const DATABASE_URL_TYPES: Record<string, DatabaseType> = {
  mysql: 'mysql',
  mariadb: 'mariadb',
  postgres: 'postgres',
  postgresql: 'postgres',
  mssql: 'sqlserver',
  sqlserver: 'sqlserver',
}

const DEFAULT_PORTS: Partial<Record<DatabaseType, number>> = {
  mysql: 3306,
  mariadb: 3306,
  postgres: 5432,
  sqlserver: 1433,
}

function decodeUrlPart(value: string, field: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new Error(`${field}包含无效的 URL 编码。`)
  }
}

function sslModeFromUrl(url: URL): string {
  const sslMode = url.searchParams.get('sslmode')?.toLowerCase()
  if (sslMode && ['prefer', 'require', 'disable', 'verify-full'].includes(sslMode)) return sslMode

  const ssl = url.searchParams.get('ssl')?.toLowerCase()
  if (ssl === 'true' || ssl === '1') return 'require'
  if (ssl === 'false' || ssl === '0') return 'disable'
  return 'prefer'
}

export function parseDataSourceUrl(value: string): Partial<DataSourceInput> {
  const input = value.trim()
  if (!input) throw new Error('请先粘贴数据库连接串。')

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('无法识别连接串，请检查格式。')
  }

  const protocol = url.protocol.replace(/:$/, '').toLowerCase()
  const type = DATABASE_URL_TYPES[protocol]
  if (!type) throw new Error('暂不支持该连接串类型。')
  if (!url.hostname) throw new Error('连接串中缺少主机地址。')

  const database = decodeUrlPart(url.pathname.replace(/^\/+/, ''), '数据库名称')
  const port = url.port ? Number(url.port) : DEFAULT_PORTS[type]

  return {
    type,
    host: url.hostname,
    port,
    database,
    username: decodeUrlPart(url.username, '用户名'),
    password: decodeUrlPart(url.password, '密码'),
    sslMode: sslModeFromUrl(url),
    filePath: '',
  }
}
