// Author: David Matura

// How times read: a clock time, the day where it isn't today, how long ago, and how often checks run.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// How long before the refresh something happened, rounded down: "5m", "2h", "3d", or "" under a minute. A time
// later than the refresh by more than clocks drift apart cannot be placed, and says nothing.
export function elapsed(at: number, now: number): string | null {
  const age = now - at
  if (!Number.isFinite(age) || age < -MINUTE) {
    return null
  }
  if (age < MINUTE) {
    return ""
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)}m`
  }

  return age < DAY ? `${Math.floor(age / HOUR)}h` : `${Math.floor(age / DAY)}d`
}

export function ago(at: number, now: number): string | null {
  const span = elapsed(at, now)

  return span === null ? null : span === "" ? "just now" : `${span} ago`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// When the last look was, in the person's own time: the time alone today, then "yesterday", then the date.
export function lookedAt(at: number, now: number): string {
  const time = new Date(at)
  const today = new Date(now)
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const isSameDay = (one: Date, other: Date): boolean => one.toDateString() === other.toDateString()

  if (isSameDay(time, today)) {
    return clockTime(at)
  }
  if (isSameDay(time, yesterday)) {
    return `yesterday ${clockTime(at)}`
  }

  return `${time.getDate()} ${MONTHS[time.getMonth()]} ${clockTime(at)}`
}

// How often checks run by themselves, as a problem's box and /prs say it: "Checking again every 3 minutes."
export function checkingAgain(minutes: number): string {
  return `Checking again ${every(minutes)}.`
}

function every(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`
  }

  return minutes === 1 ? "every minute" : `every ${minutes} minutes`
}

export function clockTime(ms: number): string {
  const time = new Date(ms)

  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`
}
