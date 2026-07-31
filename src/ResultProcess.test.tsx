import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResultProcess } from './ResultProcess'

describe('ResultProcess', () => {
  it('keeps each process step and its query result collapsed by default', () => {
    const html = renderToStaticMarkup(<ResultProcess logs={[{
      id: 'querying-1',
      stage: 'querying',
      title: '执行 SQL',
      detail: 'SELECT name, status FROM projects',
      queryResult: {
        columns: ['name', 'status'],
        rows: [{ name: 'Nova', status: 'active' }],
        truncated: false,
      },
      status: 'success',
      elapsedMs: 18,
    }]} />)

    expect(html).toContain('执行 SQL')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('SELECT name, status FROM projects')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('Nova')
  })
})
