import type { NextRequest } from 'next/server';
import { studioPost } from '@/lib/server/route';
import { Problem } from '@/lib/shared/validation';
import { database } from '@/lib/iam/sessions';
import { createScopeType } from '@/lib/territory/store';
import { defineFieldType, defineProgramKind } from '@/lib/catalog/references';
import { standardTypes } from '@/lib/iam/wizard';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = { path: '/api/v1/setup', studio: '/administration/creer', denial: 'setup.access', label: 'setup' };

// Creates, at the super-administrator's request, the usual reference types that
// are still missing (each through its module's own checks); they stay editable data.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, options, async ({ settings, actor, correlation }) => {
    if (operation.join('/') !== 'standard-types') throw new Problem(404, 'Opération inconnue');
    const store = database(settings);
    const { rows: [root] } = await store.query<{ id: string; type_code: string }>('SELECT id, type_code FROM unoa.scope WHERE parent_id IS NULL');
    const { rows: allowed } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'territory.define', $2) AND unoa.has_scope_permission($1, 'catalog.define', $2) AS ok", [actor, root.id]);
    if (!allowed[0]?.ok) throw new Problem(403, 'Réservé au super-administrateur');
    const existing = async (table: string) => new Set((await store.query<{ code: string }>(`SELECT code FROM unoa.${table}`)).rows.map(row => row.code));
    const [scopeTypes, fieldTypes, programKinds] = await Promise.all([existing('scope_type'), existing('field_type'), existing('program_kind')]);
    const created: string[] = [];
    for (const item of standardTypes.scopes.filter(type => !scopeTypes.has(type.code))) {
      await createScopeType(settings, actor, { scopeId: root.id, code: item.code, label: item.label, nature: item.nature,
        parentTypes: item.parents.map(parent => parent === '@root' ? root.type_code : parent) }, correlation);
      created.push(item.label);
    }
    for (const item of standardTypes.fields.filter(type => !fieldTypes.has(type.code))) {
      await defineFieldType(settings, actor, { code: item.code, label: item.label, rootAllowed: item.rootAllowed, parentTypes: item.parents }, correlation);
      created.push(item.label);
    }
    for (const item of standardTypes.programs.filter(type => !programKinds.has(type.code))) {
      await defineProgramKind(settings, actor, { code: item.code, label: item.label, degreeAwarding: item.degreeAwarding }, correlation);
      created.push(item.label);
    }
    return { created };
  });
}
