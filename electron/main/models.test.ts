import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { fetchModelIds, modelsEndpoint, parseModelIds } from './models.js'

describe('modelsEndpoint', () => {
  it('normalizes trailing slashes before appending /models', () => {
    expect(modelsEndpoint('https://api.example.com/v1///')).toBe('https://api.example.com/v1/models')
  })
})

describe('parseModelIds', () => {
  it('returns sorted unique model ids and ignores invalid entries', () => {
    expect(parseModelIds({ data: [{ id: 'gpt-b' }, { id: 'gpt-a' }, { id: 'gpt-b' }, { id: null }] }))
      .toEqual(['gpt-a', 'gpt-b'])
  })

  it('returns an empty list for incompatible responses', () => {
    expect(parseModelIds({ models: [] })).toEqual([])
  })
})

describe('fetchModelIds', () => {
  it('uses GET /models with bearer authentication', async () => {
    let requestMethod = ''
    let requestUrl = ''
    let authorization = ''
    const server = createServer((request, response) => {
      requestMethod = request.method ?? ''
      requestUrl = request.url ?? ''
      authorization = request.headers.authorization ?? ''
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ data: [{ id: 'nova-model' }] }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务未启动。')

    try {
      await expect(fetchModelIds(`http://127.0.0.1:${address.port}/v1`, 'test-key'))
        .resolves.toEqual(['nova-model'])
      expect(requestMethod).toBe('GET')
      expect(requestUrl).toBe('/v1/models')
      expect(authorization).toBe('Bearer test-key')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
