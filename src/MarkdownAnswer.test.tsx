import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MarkdownAnswer } from './MarkdownAnswer'

describe('MarkdownAnswer', () => {
  it('renders common Markdown and GFM content', () => {
    const html = renderToStaticMarkup(
      <MarkdownAnswer>{'**重点**\n\n- 第一项\n- 第二项\n\n| 指标 | 数值 |\n| --- | ---: |\n| 订单 | 42 |'}</MarkdownAnswer>,
    )

    expect(html).toContain('<strong>重点</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<table>')
  })

  it('does not render raw HTML from model output', () => {
    const html = renderToStaticMarkup(<MarkdownAnswer>{'<script>alert(1)</script>\n\n安全内容'}</MarkdownAnswer>)

    expect(html).not.toContain('<script>')
    expect(html).toContain('安全内容')
  })
})
