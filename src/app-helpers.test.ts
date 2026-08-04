import { describe, expect, it, vi } from 'vitest'
import type { QueryRun, SavedSql } from '../electron/shared/types'
import {
  applyModelProviderPreset,
  MODEL_PROVIDER_PRESETS,
  initialCardView,
  initialPage,
  modelProviderPresetForBaseUrl,
  savedSqlForSource,
} from './app-helpers'

describe('initialPage', () => {
  it('returns to query when an old settings route was persisted', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'sources' })
    try {
      expect(initialPage()).toBe('query')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('redirects the removed funnel route to smart query', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'funnels' })
    try {
      expect(initialPage()).toBe('query')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

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

describe('initialCardView', () => {
  it('uses the metric view for a single numeric result', () => {
    const run = {
      id: 'run-metric',
      table: { columns: ['total'], rows: [{ total: 42 }], truncated: false },
      processLogs: [],
    } as unknown as QueryRun
    expect(initialCardView(run)).toBe('metric')
    expect(initialCardView(run, 'table')).toBe('table')
  })
})

describe('model provider presets', () => {
  it('matches provider endpoints regardless of trailing slash or case', () => {
    expect(modelProviderPresetForBaseUrl('HTTPS://API.DEEPSEEK.COM/V1///')?.id).toBe('deepseek')
    expect(modelProviderPresetForBaseUrl('https://example.com/v1')).toBeNull()
  })

  it('applies connection defaults without discarding the saved identity or API key input', () => {
    const preset = MODEL_PROVIDER_PRESETS.find((item) => item.id === 'qwen')!
    expect(applyModelProviderPreset({
      id: 'channel-id',
      name: '旧名称',
      baseUrl: 'https://old.example.com/v1',
      model: 'old-model',
      availableModels: ['old-model'],
      apiKey: 'secret',
    }, preset)).toEqual({
      id: 'channel-id',
      name: '通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      availableModels: [],
      apiKey: 'secret',
    })
  })
})
