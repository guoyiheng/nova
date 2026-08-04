import { describe, expect, it } from 'vitest'
import { dashboardRequiredRows, findNearestAvailablePosition, findOpenPosition, isRectAvailable, normalizeDashboardCards, pushLayoutCollisions, snapSizeToNeighbors } from './dashboard-grid.js'
import type { DashboardCard } from './types.js'

const card = (id: string, x: number, y: number, width: number, height: number): DashboardCard => ({
  id,
  queryRunId: `${id}-run`,
  title: id,
  view: 'chart',
  chartType: 'bar',
  x,
  y,
  width,
  height,
})

describe('dashboard grid', () => {
  it('finds the first available position and detects collisions', () => {
    const cards = [card('a', 0, 0, 2, 2)]
    expect(findOpenPosition(cards, 2, 2, 4)).toEqual({ x: 2, y: 0, width: 2, height: 2 })
    expect(isRectAvailable(cards, { x: 1, y: 0, width: 2, height: 2 }, 4)).toBe(false)
  })

  it('finds nearest available position when target collides', () => {
    const cards = [card('a', 0, 0, 2, 2)]
    expect(findNearestAvailablePosition(cards, 2, 2, 4, 0, 0)).toEqual({ x: 2, y: 0, width: 2, height: 2 })
  })

  it('pushes colliding cards downward smoothly when moving or resizing', () => {
    const cards = [card('a', 0, 0, 2, 2), card('b', 0, 2, 2, 2)]
    // 将卡片 a 扩大到高度 3，导致卡片 b 被向下推移到 y = 3
    const pushed = pushLayoutCollisions(cards, 'a', { x: 0, y: 0, width: 2, height: 3 }, 4)
    expect(pushed.find((c) => c.id === 'b')?.y).toBe(3)
  })

  it('normalizes legacy positions without overlap', () => {
    const cards = [card('a', 0, 0, 2, 2), card('b', 0, 0, 2, 2)]
    const normalized = normalizeDashboardCards(cards, 4)
    expect(normalized.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }])
    expect(dashboardRequiredRows(normalized)).toBe(4)
  })

  it('snaps a resize close to a neighboring card size', () => {
    const cards = [card('a', 0, 0, 2, 2), card('b', 2, 0, 3, 3)]
    expect(snapSizeToNeighbors(cards, 0, 2.12, 2.16, 6)).toEqual({ width: 2, height: 2 })
    expect(snapSizeToNeighbors(cards, 0, 2.9, 3.05, 6)).toEqual({ width: 3, height: 3 })
  })
})


