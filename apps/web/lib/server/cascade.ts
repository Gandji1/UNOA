import 'server-only';
import { ensure } from '@/lib/shared/validation';
import type { Queryable } from '@/lib/server/db';

// Administrative cascade (ADR-0016): one creates only under the scope where one
// is directly named; upper levels read and monitor but do not create below.
const refusals: Record<string, string> = {
  territory: 'Un pays est créé par le super-administrateur (une région par l’administrateur du pays)',
  institution: 'Un établissement est créé par l’administrateur du pays',
  centre: 'Un campus est créé par le recteur de l’établissement',
  faculty: 'Une faculté est créée par le recteur (administrateur d’établissement)',
  department: 'Un département est créé par le doyen de la faculté',
  catalog: 'Filières, formations et matières sont créées par le chef de département, dans son département',
};

export async function requireCascade(store: Queryable, actor: string, permission: string, parent: string, kind: keyof typeof refusals) {
  const { rows: [row] } = await store.query<{ ok: boolean }>('SELECT unoa.may_create($1, $2, $3, $4) AS ok', [actor, permission, parent, kind]);
  ensure(row?.ok, 403, refusals[kind]);
}
