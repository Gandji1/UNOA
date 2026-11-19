export interface ParameterVersion<T> {
  key: string;
  scope: string;
  effectiveFrom: string;
  effectiveUntil?: string;
  state: 'draft' | 'published';
  version: number;
  value: T;
}

function instant(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || !/(Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new RangeError('Un instant avec fuseau horaire est requis.');
  }
  return timestamp;
}

/** The caller supplies the authorized scopes in descending order of precedence. */
export function resolveParameter<T>(
  key: string,
  scopes: readonly string[],
  asOf: string,
  versions: readonly ParameterVersion<T>[],
): ParameterVersion<T> | null {
  const date = instant(asOf);
  for (const scope of scopes) {
    const active = versions.filter(row =>
      row.key === key && row.scope === scope && row.state === 'published' &&
      instant(row.effectiveFrom) <= date &&
      (row.effectiveUntil === undefined || date < instant(row.effectiveUntil))
    );
    active.sort((a,b) => instant(b.effectiveFrom) - instant(a.effectiveFrom) || b.version - a.version);
    if (active.length) return active[0];
  }
  return null;
}
