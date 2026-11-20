// Converts a wall-clock time in an IANA zone to an instant, without a time
// library: the zone offset is read from the runtime ICU data.
function offset(instant: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - instant;
}

export function zonedToUtc(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const naive = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]);
  let guess = naive - offset(naive, timeZone);
  guess = naive - offset(guess, timeZone);
  const result = new Date(guess);
  return Number.isFinite(result.getTime()) ? result : null;
}

export function formatInZone(instant: Date | string, timeZone: string, locale = 'fr-FR') {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(instant))
    + ' (' + timeZone + ')';
}
