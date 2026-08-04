import { describe, expect, it } from 'vitest'
import { nextScheduledRun } from './scheduler.js'

describe('nextScheduledRun', () => {
  it('computes interval schedules', () => {
    expect(nextScheduledRun({ scheduleKind: 'interval', intervalMinutes: 30, timeOfDay: '', dayOfWeek: null }, new Date('2026-08-04T02:00:00.000Z')).toISOString())
      .toBe('2026-08-04T02:30:00.000Z')
  })

  it('moves daily schedules to tomorrow after the configured local time', () => {
    const from = new Date(2026, 7, 4, 18, 30)
    const next = nextScheduledRun({ scheduleKind: 'daily', intervalMinutes: null, timeOfDay: '09:15', dayOfWeek: null }, from)
    expect([next.getFullYear(), next.getMonth(), next.getDate(), next.getHours(), next.getMinutes()]).toEqual([2026, 7, 5, 9, 15])
  })

  it('computes the next weekly occurrence', () => {
    const from = new Date(2026, 7, 4, 8, 0) // Tuesday
    const next = nextScheduledRun({ scheduleKind: 'weekly', intervalMinutes: null, timeOfDay: '10:00', dayOfWeek: 1 }, from)
    expect([next.getDay(), next.getDate(), next.getHours()]).toEqual([1, 10, 10])
  })
})
