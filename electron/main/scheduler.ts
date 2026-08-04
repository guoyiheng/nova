import type { ScheduledTask } from '../shared/types.js'

type ScheduleDefinition = Pick<ScheduledTask, 'scheduleKind' | 'intervalMinutes' | 'timeOfDay' | 'dayOfWeek'>

function parsedTime(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)
  if (!match) throw new Error('执行时间格式无效。')
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error('执行时间格式无效。')
  return { hours, minutes }
}

export function nextScheduledRun(schedule: ScheduleDefinition, from = new Date()): Date {
  if (schedule.scheduleKind === 'interval') {
    const minutes = schedule.intervalMinutes ?? 60
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 10_080) throw new Error('执行间隔应在 15 分钟到 7 天之间。')
    return new Date(from.getTime() + minutes * 60_000)
  }

  const { hours, minutes } = parsedTime(schedule.timeOfDay)
  const next = new Date(from)
  next.setSeconds(0, 0)
  next.setHours(hours, minutes, 0, 0)

  if (schedule.scheduleKind === 'daily') {
    if (next <= from) next.setDate(next.getDate() + 1)
    return next
  }

  const dayOfWeek = schedule.dayOfWeek ?? 1
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new Error('每周执行日期无效。')
  let dayOffset = (dayOfWeek - next.getDay() + 7) % 7
  if (dayOffset === 0 && next <= from) dayOffset = 7
  next.setDate(next.getDate() + dayOffset)
  return next
}

export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private ticking = false
  private readonly running = new Set<string>()

  constructor(
    private readonly listDue: (now: Date) => ScheduledTask[],
    private readonly runTask: (task: ScheduledTask) => Promise<void>,
  ) {}

  start() {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), 30_000)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      const tasks = this.listDue(new Date()).filter((task) => !this.running.has(task.id))
      await Promise.all(tasks.map(async (task) => {
        this.running.add(task.id)
        try {
          await this.runTask(task)
        } finally {
          this.running.delete(task.id)
        }
      }))
    } finally {
      this.ticking = false
    }
  }
}
