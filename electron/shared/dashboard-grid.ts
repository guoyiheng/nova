import type { DashboardCard } from './types.js'

export type DashboardRect = Pick<DashboardCard, 'x' | 'y' | 'width' | 'height'>

export function rectsOverlap(a: DashboardRect, b: DashboardRect) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

export function isRectAvailable(cards: DashboardRect[], candidate: DashboardRect, columns: number, ignoreIndex = -1) {
  if (candidate.x < 0 || candidate.y < 0 || candidate.width < 1 || candidate.height < 1) return false
  if (candidate.x + candidate.width > columns) return false
  return cards.every((card, index) => index === ignoreIndex || !rectsOverlap(card, candidate))
}

export function findOpenPosition(cards: DashboardRect[], width: number, height: number, columns: number, startY = 0) {
  const safeWidth = Math.min(columns, Math.max(1, Math.round(width)))
  const safeHeight = Math.max(1, Math.round(height))
  for (let y = Math.max(0, Math.round(startY)); y < 1000; y += 1) {
    for (let x = 0; x <= columns - safeWidth; x += 1) {
      const candidate = { x, y, width: safeWidth, height: safeHeight }
      if (isRectAvailable(cards, candidate, columns)) return candidate
    }
  }
  return { x: 0, y: Math.max(0, startY), width: safeWidth, height: safeHeight }
}

export function normalizeDashboardCards(cards: DashboardCard[], columns: number) {
  const placed: DashboardCard[] = []
  for (const card of cards) {
    const width = Math.min(columns, Math.max(1, Math.round(card.width || 1)))
    const height = Math.max(1, Math.round(card.height || 2))
    const requested = { x: Math.max(0, Math.round(card.x || 0)), y: Math.max(0, Math.round(card.y || 0)), width, height }
    const rect = isRectAvailable(placed, requested, columns) ? requested : findOpenPosition(placed, width, height, columns)
    placed.push({ ...card, ...rect })
  }
  return placed
}

export function dashboardRequiredRows(cards: DashboardRect[], minimum = 4) {
  return Math.max(minimum, ...cards.map((card) => card.y + card.height))
}

export function snapSizeToNeighbors(cards: DashboardCard[], index: number, width: number, height: number, columns: number) {
  const current = cards[index]
  if (!current) return { width: Math.min(columns, Math.max(1, Math.round(width))), height: Math.max(1, Math.round(height)) }
  const candidates = cards.filter((_, cardIndex) => cardIndex !== index)
  const nearWidth = candidates.map((card) => card.width).find((value) => Math.abs(value - width) <= 0.22)
  const nearHeight = candidates.map((card) => card.height).find((value) => Math.abs(value - height) <= 0.22)
  return {
    width: Math.min(columns, Math.max(1, Math.round(nearWidth ?? width))),
    height: Math.max(1, Math.round(nearHeight ?? height)),
  }
}

export function findNearestAvailablePosition(
  cards: DashboardRect[],
  width: number,
  height: number,
  columns: number,
  targetX: number,
  targetY: number,
  ignoreIndex = -1
): DashboardRect {
  const safeWidth = Math.min(columns, Math.max(1, Math.round(width)))
  const safeHeight = Math.max(1, Math.round(height))
  const clampedX = Math.max(0, Math.min(columns - safeWidth, Math.round(targetX)))
  const clampedY = Math.max(0, Math.round(targetY))

  const candidate = { x: clampedX, y: clampedY, width: safeWidth, height: safeHeight }
  if (isRectAvailable(cards, candidate, columns, ignoreIndex)) {
    return candidate
  }

  // 沿辐射范围查找最近的可用位置
  let bestRect: DashboardRect = candidate
  let minDistance = Infinity

  for (let radius = 1; radius <= 20; radius++) {
    let foundInRadius = false
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
        const testX = clampedX + dx
        const testY = clampedY + dy
        if (testX < 0 || testX + safeWidth > columns || testY < 0) continue

        const testRect = { x: testX, y: testY, width: safeWidth, height: safeHeight }
        if (isRectAvailable(cards, testRect, columns, ignoreIndex)) {
          const dist = Math.hypot(testX - targetX, testY - targetY)
          if (dist < minDistance) {
            minDistance = dist
            bestRect = testRect
            foundInRadius = true
          }
        }
      }
    }
    if (foundInRadius) break
  }

  if (minDistance !== Infinity) {
    return bestRect
  }

  // 退化为查找首个空位
  return findOpenPosition(cards, safeWidth, safeHeight, columns, clampedY)
}

