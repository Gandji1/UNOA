import 'server-only';
// Programmes, their translated titles and their regulatory authorizations.
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { amount, boundedText, businessCode, choice, ensure, flag, integer, list, optional, optionalText, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { language, typeCode } from '@/lib/territory/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { context, program, requireContext, zones } from './access';

export const authorizationStatuses = ['preparation', 'non_degree', 'conditional', 'authorized', 'suspended', 'expired'] as const;

export function versionFields(input: Input) {
  return {
    title: boundedText(input.versionTitle ?? input.title, 200, 'Intitulé de version'),
    organisation: boundedText(input.organisation, 120, 'Organisation des périodes'),
    duration: boundedText(input.duration, 120, 'Durée'),
    deliveryMode: boundedText(input.deliveryMode, 120, 'Modalité'),
    creditUnit: boundedText(input.creditUnit, 60, 'Unité de crédit'),
    expectedCredits: optional(input.expectedCredits, value => amount(value, 'Total attendu', true)),
    languages: list(input.languages).map(language),
    capacity: optional(input.capacity, value => integer(value, 'Capacité', 1, 1_000_000)),
    objectives: optional(input.objectives, text(4000, 'Objectifs')),
    admission: optional(input.admission, text(4000, 'Conditions d’admission')),
  };
}

export async function createProgram(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const item = {
    kind: typeCode(input.kindCode),
    field: optional(input.fieldId, uuid),
    code: businessCode(input.code),
    title: boundedText(input.title, 200, 'Intitulé'),
  };
  const version = versionFields({ ...input, versionTitle: input.title });
  return transaction(settings, 'unoa.catalog.' + scopeId, async store => {
    await requireContext(store, actor, scopeId, 'write');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.program(owner_scope_id, field_id, kind_code, code, title, created_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [scopeId, item.field, item.kind, item.code, item.title, actor]);
    const versionId = await insertVersion(store, rows[0].id, 1, null, version, actor);
    await audit(store, actor, scopeId, 'catalog.program_created', correlation, rows[0].id);
    return { scopeId, id: rows[0].id, versionId };
  });
}

export async function insertVersion(store: Queryable, programId: string, number: number, basedOn: string | null,
  version: ReturnType<typeof versionFields>, actor: string) {
  const { rows } = await store.query<{ id: string }>(`
    INSERT INTO unoa.program_version(program_id, number, based_on, title, organisation, duration, delivery_mode,
      credit_unit, expected_credits, languages, capacity, objectives, admission, author_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id
  `, [programId, number, basedOn, version.title, version.organisation, version.duration, version.deliveryMode,
    version.creditUnit, version.expectedCredits, version.languages, version.capacity, version.objectives,
    version.admission, actor]);
  return rows[0].id;
}


export async function programDetails(settings: IamSettings, actor: string, programId: string) {
  const store = database(settings);
  const item = await program(store, actor, uuid(programId));
  ensure(item, 403, 'Programme inaccessible');
  const scope = await context(store, actor, item.owner_scope_id);
  const [labels, versions, authorizations, territories] = await Promise.all([
    store.query<{ language: string; title: string; summary: string | null }>(
      'SELECT language, title, summary FROM unoa.program_label WHERE program_id = $1 ORDER BY language', [item.id],
    ),
    store.query<{ id: string; number: number; state: string; title: string; published_at: Date | null; admission_open: boolean; author_id: string }>(`
      SELECT id, number, state, title, published_at, admission_open, author_id
      FROM unoa.program_version WHERE program_id = $1 ORDER BY number DESC
    `, [item.id]),
    store.query<{
      id: string; status: string; authority: string; evidence: string; territory_label: string | null;
      valid_from: Date; valid_until: Date | null; recorded_by: string; verified_by: string | null; verified_at: Date | null;
    }>(`
      SELECT authorization_record.id, authorization_record.status, authorization_record.authority,
             authorization_record.evidence, zone.label AS territory_label, authorization_record.valid_from,
             authorization_record.valid_until, authorization_record.recorded_by,
             authorization_record.verified_by, authorization_record.verified_at
      FROM unoa.program_authorization AS authorization_record
      LEFT JOIN unoa.scope AS zone ON zone.id = authorization_record.territory_id
      WHERE authorization_record.program_id = $1 ORDER BY authorization_record.valid_from DESC, authorization_record.recorded_at DESC
    `, [item.id]),
    zones(store, item.institution_id, ['territory', 'jurisdiction']),
  ]);
  return { program: item, scope, labels: labels.rows, versions: versions.rows, authorizations: authorizations.rows, territories };
}


export async function setProgramLabel(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const programId = uuid(id);
  const tag = language(input.language);
  const title = boundedText(input.title, 200, 'Intitulé traduit');
  const summary = optional(input.summary, text(2000, 'Résumé'));
  return transaction(settings, 'unoa.catalog.program.' + programId, async store => {
    const item = await program(store, actor, programId);
    ensure(item, 403, 'Programme inaccessible');
    await requireContext(store, actor, item.owner_scope_id, 'write');
    await store.query(`
      INSERT INTO unoa.program_label(program_id, language, title, summary) VALUES ($1, $2, $3, $4)
      ON CONFLICT (program_id, language) DO UPDATE SET title = excluded.title, summary = excluded.summary, updated_at = now()
    `, [programId, tag, title, summary]);
    await audit(store, actor, item.owner_scope_id, 'catalog.label_set', correlation, programId);
    return { scopeId: item.owner_scope_id, id: programId };
  });
}

export async function recordAuthorization(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const programId = uuid(id);
  const item = {
    status: choice(input.status, authorizationStatuses, 'Statut réglementaire'),
    authority: boundedText(input.authority, 200, 'Autorité'),
    evidence: boundedText(input.evidence, 1000, 'Pièce justificative'),
    territory: optional(input.territoryId, uuid),
    validFrom: utcTime(input.validFrom),
    validUntil: optional(input.validUntil, utcTime),
  };
  return transaction(settings, 'unoa.catalog.program.' + programId, async store => {
    const found = await program(store, actor, programId);
    ensure(found, 403, 'Programme inaccessible');
    await requireContext(store, actor, found.owner_scope_id, 'authorize');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.program_authorization(program_id, territory_id, status, authority, evidence, valid_from, valid_until, recorded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [programId, item.territory, item.status, item.authority, item.evidence, item.validFrom, item.validUntil, actor]);
    await audit(store, actor, found.owner_scope_id, 'catalog.authorization_recorded', correlation, rows[0].id);
    return { scopeId: found.owner_scope_id, id: programId };
  });
}

export async function verifyAuthorization(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const authorizationId = uuid(id);
  const programId = uuid(input.programId);
  return transaction(settings, 'unoa.catalog.program.' + programId, async store => {
    const found = await program(store, actor, programId);
    ensure(found, 403, 'Programme inaccessible');
    await requireContext(store, actor, found.owner_scope_id, 'authorize');
    const { rows } = await store.query<{ recorded_by: string; verified_by: string | null }>(
      'SELECT recorded_by, verified_by FROM unoa.program_authorization WHERE id = $1 AND program_id = $2 FOR UPDATE',
      [authorizationId, programId],
    );
    ensure(rows[0], 404, 'Autorisation introuvable');
    ensure(rows[0].verified_by === null, 409, 'Cette autorisation est déjà vérifiée');
    ensure(rows[0].recorded_by !== actor, 403, 'La vérification revient à une autre personne');
    await store.query('UPDATE unoa.program_authorization SET verified_by = $2, verified_at = now() WHERE id = $1',
      [authorizationId, actor]);
    await audit(store, actor, found.owner_scope_id, 'catalog.authorization_verified', correlation, authorizationId);
    return { scopeId: found.owner_scope_id, id: programId };
  });
}

