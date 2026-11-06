// Pure formatting/parsing helpers for bot flows (unit-tested in __tests__/format.test.ts).

// shortcut: pilot is India-only, so times use a fixed IST offset; switch to Intl time zones before expanding.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface TimeWindowOption {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

/** UTC instant for an IST wall-clock hour, `dayOffset` days from today's IST date. */
function istAt(now: Date, dayOffset: number, hour: number): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, hour) - IST_OFFSET_MS);
}

/** Preferred-time choices (spec §6.4 step 8). Today-evening is hidden once it has started. */
export function timeWindowOptions(now: Date = new Date()): TimeWindowOption[] {
  const options: TimeWindowOption[] = [
    { key: 'asap', label: '⚡ As soon as possible', start: now, end: new Date(now.getTime() + 2 * HOUR_MS) },
  ];
  const todayEvening = istAt(now, 0, 17);
  if (now < todayEvening) {
    options.push({ key: 'today_eve', label: '🌆 Today 5-8 PM', start: todayEvening, end: istAt(now, 0, 20) });
  }
  options.push(
    { key: 'tom_morn', label: '🌅 Tomorrow 9 AM-12 PM', start: istAt(now, 1, 9), end: istAt(now, 1, 12) },
    { key: 'tom_eve', label: '🌆 Tomorrow 5-8 PM', start: istAt(now, 1, 17), end: istAt(now, 1, 20) }
  );
  return options;
}

/** "Today, 5 PM-8 PM" style label for a stored window (spec §9.3 offer message). */
export function formatWindow(startIso: string, endIso: string, now: Date = new Date()): string {
  const start = new Date(new Date(startIso).getTime() + IST_OFFSET_MS);
  const end = new Date(new Date(endIso).getTime() + IST_OFFSET_MS);
  const today = new Date(now.getTime() + IST_OFFSET_MS);
  const dayDiff = Math.round(
    (Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) /
      (24 * HOUR_MS)
  );
  const day =
    dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : `${start.getUTCDate()}/${start.getUTCMonth() + 1}`;
  const hour = (d: Date) => {
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
  };
  return `${day}, ${hour(start)}-${hour(end)}`;
}

/** "6 Nov, 3:05 PM" in IST, for request timelines. */
export function formatDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getUTCHours();
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "How long will you be online?" choices (spec §6.3 step 4). "Until 9 PM" only while it's at least an hour away. */
export function onlineUntilOptions(now: Date = new Date()): { key: string; label: string; hours: number }[] {
  const options = [
    { key: '2', label: '2 hours', hours: 2 },
    { key: '4', label: '4 hours', hours: 4 },
    { key: '8', label: '8 hours', hours: 8 },
  ];
  const hoursTo9pm = (istAt(now, 0, 21).getTime() - now.getTime()) / HOUR_MS;
  if (hoursTo9pm >= 1) options.push({ key: 'eod', label: 'Until 9 PM', hours: Math.round(hoursTo9pm * 100) / 100 });
  return options;
}

export interface EstimateAmounts {
  visitCharge: number;
  labourAmount: number;
  partsAmount: number;
}

/**
 * Parses "visit, labour, parts" amounts typed by a technician, e.g. "200, 800, 0" or "₹200 800".
 * Missing trailing amounts count as 0. Returns null if nothing usable was typed.
 */
export function parseEstimate(text: string): EstimateAmounts | null {
  const numbers = (text.replace(/,(?=\d{3}\b)/g, '').match(/\d+(\.\d+)?/g) ?? []).map(Number);
  if (numbers.length === 0 || numbers.length > 3 || numbers.some((n) => !Number.isFinite(n) || n > 1_000_000)) return null;
  const [visitCharge = 0, labourAmount = 0, partsAmount = 0] = numbers;
  return { visitCharge, labourAmount, partsAmount };
}

/** Escapes characters that break Telegram legacy Markdown in user-supplied text. */
export function escapeMd(text: string): string {
  return text.replace(/([_*`\[])/g, '\\$1');
}
