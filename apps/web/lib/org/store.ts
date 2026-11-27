import { requireCascade } from '@/lib/server/cascade';
import 'server-only';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, numeric, ensure, utcTime, uuid, type Input, businessCode, choice, flag, optionalText } from '@/lib/shared/validation';
import { typeCode } from '@/lib/territory/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';

export const capacities = ['titular', 'deputy', 'interim'] as const;
export const changeKinds = ['closure', 'merger', 'transfer'] as const;


export interface OrgScope {
  id: string;
  label: string;
  type_code: string;
  type_label: string;
  nature: 'institution' | 'academic_unit';
  parent_id: string | null;
  parent_label: string | null;
  present_from: Date;
  present_until: Date | null;
  code: string | null;
  status: 'proposed' | 'active' | 'rejected' | 'closed' | null;
  public: boolean | null;
  mission: string | null;
  proposed_by: string | null;
  institution_label: string | null;
  write: boolean;
  approve: boolean;
  creates: boolean;
}

const scopeFields = `
  scope.id, scope.label, scope.type_code, kind.label AS type_label, kind.nature, scope.parent_id,
  parent.label AS parent_label, scope.present_from, scope.present_until,
  unit.code, unit.status, unit.public, unit.mission, unit.proposed_by,
  institution.label AS institution_label,
  unoa.has_scope_permission($1, 'org.write', scope.id) AS write,
  unoa.has_scope_permission($1, 'org.approve', scope.id) AS approve,
  unoa.may_create($1, 'org.write', scope.id, CASE WHEN unoa.cascade_level(scope.id) = 'faculty' THEN 'department' ELSE 'faculty' END) AS creates
  FROM unoa.scope AS scope
  JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
  LEFT JOIN unoa.scope AS parent ON parent.id = scope.parent_id
  LEFT JOIN unoa.org_unit AS unit ON unit.scope_id = scope.id
  LEFT JOIN unoa.scope AS institution ON institution.id = unit.institution_id
`;

export async function orgContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<OrgScope>(`
    SELECT ${scopeFields}
    WHERE kind.nature IN ('institution', 'academic_unit')
      AND unoa.has_scope_permission($1, 'org.read', scope.id)
    ORDER BY kind.nature DESC, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

async function orgScope(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<OrgScope>(`
    SELECT ${scopeFields}
    WHERE scope.id = $2 AND kind.nature IN ('institution', 'academic_unit')
      AND unoa.has_scope_permission($1, 'org.read', scope.id)
  `, [actor, scopeId]);
  return rows[0] ?? null;
}

export interface PositionRow {
  id: string;
  title: string;
  is_head: boolean;
  seats: number;
  public: boolean;
  appointments: {
    id: string; account_id: string; capacity: string; public_name: string | null; reason: string;
    effective_from: string; effective_until: string | null; current: boolean;
  }[];
}

export async function orgDetails(settings: IamSettings, actor: string, scopeId: string) {
  const store = database(settings);
  const scope = await orgScope(store, actor, uuid(scopeId));
  ensure(scope, 403, 'Structure inaccessible');
  const [children, types, positions, capacity, changes, lineage] = await Promise.all([
    store.query<OrgScope>(`
      SELECT ${scopeFields}
      WHERE scope.parent_id = $2 AND kind.nature = 'academic_unit'
        AND unoa.has_scope_permission($1, 'org.read', scope.id)
      ORDER BY scope.label LIMIT 200
    `, [actor, scope.id]),
    store.query<{ code: string; label: string }>(`
      SELECT kind.code, kind.label FROM unoa.scope_type AS kind
      JOIN unoa.scope_type_parent AS rule ON rule.type_code = kind.code
      WHERE kind.nature = 'academic_unit' AND rule.parent_type_code = $1
      ORDER BY kind.label
    `, [scope.type_code]),
    store.query<PositionRow>(`
      SELECT position.id, position.title, position.is_head, position.seats, position.public,
        coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', appointment.id, 'account_id', appointment.account_id, 'capacity', appointment.capacity,
          'public_name', appointment.public_name, 'reason', appointment.reason,
          'effective_from', appointment.effective_from, 'effective_until', appointment.effective_until,
          'current', appointment.effective_from <= now()
            AND (appointment.effective_until IS NULL OR appointment.effective_until > now()))
          ORDER BY appointment.effective_from DESC)
          FROM unoa.org_appointment AS appointment WHERE appointment.position_id = position.id), '[]') AS appointments
      FROM unoa.org_position AS position WHERE position.unit_id = $1
      ORDER BY position.is_head DESC, position.title LIMIT 200
    `, [scope.id]),
    store.query<{ resource: string; quantity: string; measure: string; reason: string; effective_from: Date }>(`
      SELECT DISTINCT ON (resource) resource, quantity, measure, reason, effective_from
      FROM unoa.org_capacity WHERE unit_id = $1 AND effective_from <= now()
      ORDER BY resource, effective_from DESC
    `, [scope.id]),
    store.query<{
      id: string; kind: string; target_label: string | null; reason: string; effective_at: Date; state: string;
      requested_by: string; decision_note: string | null; requested_at: Date;
    }>(`
      SELECT change.id, change.kind, target.label AS target_label, change.reason, change.effective_at,
             change.state, change.requested_by, change.decision_note, change.requested_at
      FROM unoa.org_change AS change LEFT JOIN unoa.scope AS target ON target.id = change.target_id
      WHERE change.unit_id = $1 ORDER BY change.requested_at DESC LIMIT 50
    `, [scope.id]),
    store.query<{ direction: string; kind: string; other_id: string; other_label: string }>(`
      SELECT 'successor' AS direction, link.kind, link.successor_id AS other_id, other.label AS other_label
      FROM unoa.org_succession AS link JOIN unoa.scope AS other ON other.id = link.successor_id
      WHERE link.predecessor_id = $1
      UNION ALL
      SELECT 'predecessor', link.kind, link.predecessor_id, other.label
      FROM unoa.org_succession AS link JOIN unoa.scope AS other ON other.id = link.predecessor_id
      WHERE link.successor_id = $1
    `, [scope.id]),
  ]);
  const vacancies = positions.rows
    .filter(position => !position.appointments.some(item => item.current && item.capacity === 'titular'))
    .map(position => position.title);
  return {
    scope, children: children.rows, unitTypes: types.rows, positions: positions.rows,
    capacity: capacity.rows, changes: changes.rows, lineage: lineage.rows, vacancies,
  };
}

async function requireScope(store: Queryable, actor: string, scopeId: string, permission: 'org.write' | 'org.approve') {
  const scope = await orgScope(store, actor, scopeId);
  ensure(scope && scope[permission === 'org.write' ? 'write' : 'approve'], 403, 'Action non autorisée');
  return scope;
}

async function requireLivingUnit(store: Queryable, actor: string, unitId: string, permission: 'org.write' | 'org.approve') {
  const scope = await requireScope(store, actor, unitId, permission);
  ensure(scope.nature === 'academic_unit', 422, 'Cette action vise une unité académique');
  return scope;
}

export async function proposeUnit(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const parentId = uuid(input.parentId);
  const kind = typeCode(input.typeCode);
  const label = boundedText(input.label, 160, 'Libellé');
  const unit = businessCode(input.code);
  const mission = optionalText(input.mission) === null ? null : boundedText(input.mission, 2000, 'Mission');
  // Without a date (assistants), the new scope starts now, never before its parent.
  const presentFrom = input.presentFrom ? utcTime(input.presentFrom) : null;
  return transaction(settings, 'unoa.org.' + parentId, async store => {
    const parent = await requireScope(store, actor, parentId, 'org.write');
    ensure(parent.nature === 'institution' || parent.status === 'active', 422, 'La structure mère doit être active');
    const { rows } = await store.query<{ nature: string }>('SELECT nature FROM unoa.scope_type WHERE code = $1', [kind]);
    ensure(rows[0]?.nature === 'academic_unit', 422, 'Ce type n’est pas une unité académique');
    await requireCascade(store, actor, 'org.write', parentId, parent.nature === 'academic_unit' ? 'department' : 'faculty');
    const scope = await store.query<{ id: string }>(`
      INSERT INTO unoa.scope(type_code, parent_id, label, present_from)
      VALUES ($1, $2, $3, coalesce($4::timestamptz, greatest(statement_timestamp(), (SELECT present_from FROM unoa.scope WHERE id = $2)))) RETURNING id
    `, [kind, parentId, label, presentFrom]);
    const id = scope.rows[0].id;
    await store.query(`
      INSERT INTO unoa.org_unit(scope_id, code, mission, public, proposed_by, status, decided_by, decided_at, by_head)
      VALUES ($1, $2, $3, $4, $5, 'active', $5, now(), true)
    `, [id, unit, mission, flag(input.public), actor]);
    // Created by the head of the level above (cascade checked above): active at once.
    await audit(store, actor, parentId, 'org.unit_created', correlation, id);
    return { scopeId: id };
  });
}

export async function decideUnit(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const unitId = uuid(id);
  const decision = choice(input.decision, ['approve', 'reject'] as const, 'Décision');
  return transaction(settings, 'unoa.org.' + unitId, async store => {
    const unit = await requireLivingUnit(store, actor, unitId, 'org.approve');
    ensure(unit.status === 'proposed', 409, 'Cette unité a déjà été instruite');
    ensure(unit.proposed_by !== actor, 403, 'Une proposition est validée par une autre personne');
    await store.query(`
      UPDATE unoa.org_unit SET status = $2, decided_by = $3, decided_at = now() WHERE scope_id = $1
    `, [unitId, decision === 'approve' ? 'active' : 'rejected', actor]);
    if (decision === 'reject') {
      await store.query("UPDATE unoa.scope SET present_until = greatest(present_from + interval '1 second', now()) WHERE id = $1", [unitId]);
    }
    await audit(store, actor, unitId, 'org.unit_decided', correlation, unitId);
    return { scopeId: unitId };
  });
}

export async function updateUnit(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const unitId = uuid(id);
  const label = boundedText(input.label, 160, 'Libellé');
  const mission = optionalText(input.mission) === null ? null : boundedText(input.mission, 2000, 'Mission');
  return transaction(settings, 'unoa.org.' + unitId, async store => {
    const unit = await requireLivingUnit(store, actor, unitId, 'org.write');
    ensure(unit.status === 'proposed' || unit.status === 'active', 409, 'Une unité close est archivée');
    await store.query('UPDATE unoa.scope SET label = $2 WHERE id = $1', [unitId, label]);
    await store.query('UPDATE unoa.org_unit SET mission = $2, public = $3 WHERE scope_id = $1',
      [unitId, mission, flag(input.public)]);
    await audit(store, actor, unitId, 'org.unit_updated', correlation, unitId);
    return { scopeId: unitId };
  });
}

export async function createPosition(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const unitId = uuid(id);
  const title = boundedText(input.title, 160, 'Intitulé');
  const seats = input.seats === undefined || input.seats === '' ? 1 : numeric(input.seats);
  ensure(Number.isInteger(seats) && seats >= 1 && seats <= 500, 400, 'Nombre de sièges invalide');
  return transaction(settings, 'unoa.org.' + unitId, async store => {
    const unit = await requireLivingUnit(store, actor, unitId, 'org.write');
    ensure(unit.status === 'active', 422, 'Les postes se créent dans une unité active');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.org_position(unit_id, title, is_head, seats, public, created_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [unitId, title, flag(input.isHead), seats, flag(input.public), actor]);
    await audit(store, actor, unitId, 'org.position_created', correlation, rows[0].id);
    return { scopeId: unitId, id: rows[0].id };
  });
}

async function positionUnit(store: Queryable, positionId: string) {
  const { rows } = await store.query<{ unit_id: string }>('SELECT unit_id FROM unoa.org_position WHERE id = $1', [positionId]);
  ensure(rows[0], 404, 'Poste introuvable');
  return rows[0].unit_id;
}

export async function appoint(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const positionId = uuid(id);
  const accountId = uuid(input.accountId);
  const capacity = choice(input.capacity, capacities, 'Qualité');
  const publicName = optionalText(input.publicName) === null ? null : boundedText(input.publicName, 160, 'Nom publié');
  const reason = boundedText(input.reason, 500, 'Motif');
  const effectiveFrom = utcTime(input.effectiveFrom);
  const effectiveUntil = optionalText(input.effectiveUntil) === null ? null : utcTime(input.effectiveUntil);
  return transaction(settings, 'unoa.org.position.' + positionId, async store => {
    const unitId = await positionUnit(store, positionId);
    await requireLivingUnit(store, actor, unitId, 'org.write');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.org_appointment(position_id, account_id, capacity, public_name, reason,
                                       effective_from, effective_until, appointed_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [positionId, accountId, capacity, publicName, reason, effectiveFrom, effectiveUntil, actor]);
    await audit(store, actor, unitId, 'org.appointed', correlation, rows[0].id);
    return { scopeId: unitId, id: rows[0].id };
  });
}

export async function endAppointment(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const appointmentId = uuid(id);
  const effectiveUntil = utcTime(input.effectiveUntil);
  ensure(new Date(effectiveUntil).getTime() >= Date.now() - 300_000, 422, 'Une fin de fonction n’est pas rétroactive');
  return transaction(settings, 'unoa.org.appointment.' + appointmentId, async store => {
    const { rows } = await store.query<{ unit_id: string }>(`
      SELECT position.unit_id FROM unoa.org_appointment AS appointment
      JOIN unoa.org_position AS position ON position.id = appointment.position_id WHERE appointment.id = $1
    `, [appointmentId]);
    ensure(rows[0], 404, 'Nomination introuvable');
    await requireLivingUnit(store, actor, rows[0].unit_id, 'org.write');
    await store.query('UPDATE unoa.org_appointment SET effective_until = $2 WHERE id = $1', [appointmentId, effectiveUntil]);
    await audit(store, actor, rows[0].unit_id, 'org.appointment_ended', correlation, appointmentId);
    return { scopeId: rows[0].unit_id, id: appointmentId };
  });
}

export async function recordCapacity(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const unitId = uuid(id);
  const resource = boundedText(input.resource, 120, 'Ressource');
  const quantity = numeric(input.quantity);
  ensure(quantity >= 0, 400, 'Quantité invalide');
  const measure = boundedText(input.measure, 60, 'Unité de mesure');
  const reason = boundedText(input.reason, 500, 'Motif');
  const effectiveFrom = utcTime(input.effectiveFrom);
  return transaction(settings, 'unoa.org.' + unitId, async store => {
    const unit = await requireLivingUnit(store, actor, unitId, 'org.write');
    ensure(unit.status === 'active', 422, 'Les capacités concernent une unité active');
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.org_capacity(unit_id, resource, quantity, measure, reason, effective_from, recorded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [unitId, resource, quantity, measure, reason, effectiveFrom, actor]);
    await audit(store, actor, unitId, 'org.capacity_recorded', correlation, rows[0].id);
    return { scopeId: unitId, id: rows[0].id };
  });
}

export async function requestChange(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const unitId = uuid(id);
  const kind = choice(input.kind, changeKinds, 'Type de réorganisation');
  const targetId = kind === 'closure' ? null : uuid(input.targetId);
  const reason = boundedText(input.reason, 1000, 'Motif');
  const effectiveAt = utcTime(input.effectiveAt);
  return transaction(settings, 'unoa.org.' + unitId, async store => {
    await requireLivingUnit(store, actor, unitId, 'org.write');
    if (targetId) {
      // A transfer needs the right to create under the new parent; a merger needs to see the absorbing unit.
      const target = await orgScope(store, actor, targetId);
      ensure(target && (kind === 'merger' || target.write), 403, 'Structure cible non autorisée');
    }
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.org_change(unit_id, kind, target_id, reason, effective_at, requested_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
    `, [unitId, kind, targetId, reason, effectiveAt, actor]);
    await audit(store, actor, unitId, 'org.change_requested', correlation, rows[0].id);
    return { scopeId: unitId, id: rows[0].id };
  });
}

export async function decideChange(settings: IamSettings, actor: string, id: string, input: Input, correlation: string) {
  const changeId = uuid(id);
  const decision = choice(input.decision, ['approve', 'reject'] as const, 'Décision');
  const note = optionalText(input.note) === null ? null : boundedText(input.note, 1000, 'Observation');
  const { rows: found } = await database(settings).query<{ unit_id: string }>(
    'SELECT unit_id FROM unoa.org_change WHERE id = $1', [changeId],
  );
  ensure(found[0], 404, 'Demande introuvable');
  const unitId = found[0].unit_id;
  return transaction(settings, 'unoa.org.' + unitId, async store => {
    const unit = await requireLivingUnit(store, actor, unitId, 'org.approve');
    const { rows } = await store.query<{
      kind: string; target_id: string | null; effective_at: Date; state: string; requested_by: string;
    }>('SELECT kind, target_id, effective_at, state, requested_by FROM unoa.org_change WHERE id = $1 FOR UPDATE', [changeId]);
    const change = rows[0];
    ensure(change.state === 'requested', 409, 'Cette demande a déjà été instruite');
    ensure(change.requested_by !== actor, 403, 'Une réorganisation est approuvée par une autre personne');
    let successor: string | null = null;
    if (decision === 'approve') {
      ensure(change.effective_at.getTime() >= Date.now() - 300_000, 422, 'La date d’effet est dépassée');
      if (change.kind === 'transfer') {
        const target = await orgScope(store, actor, change.target_id!);
        ensure(target?.approve, 403, 'Structure cible non autorisée');
        const created = await store.query<{ id: string }>(`
          INSERT INTO unoa.scope(type_code, parent_id, label, time_zone, currency, locale, present_from)
          SELECT type_code, $2, label, time_zone, currency, locale, $3 FROM unoa.scope WHERE id = $1 RETURNING id
        `, [unitId, change.target_id, change.effective_at]);
        successor = created.rows[0].id;
      } else if (change.kind === 'merger') {
        successor = change.target_id;
      }
      await store.query(`
        UPDATE unoa.org_appointment SET effective_until = $2
        WHERE position_id IN (SELECT id FROM unoa.org_position WHERE unit_id = $1)
          AND effective_from < $2 AND (effective_until IS NULL OR effective_until > $2)
      `, [unitId, change.effective_at]);
      await store.query('UPDATE unoa.scope SET present_until = $2 WHERE id = $1', [unitId, change.effective_at]);
      await store.query("UPDATE unoa.org_unit SET status = 'closed', closed_at = now() WHERE scope_id = $1", [unitId]);
      if (change.kind === 'transfer') {
        await store.query(`
          INSERT INTO unoa.org_unit(scope_id, code, mission, public, proposed_by, status, decided_by, decided_at)
          VALUES ($1, $2, $3, $4, $5, 'active', $6, now())
        `, [successor, unit.code, unit.mission, unit.public, change.requested_by, actor]);
      }
      if (successor) {
        await store.query(`
          INSERT INTO unoa.org_succession(predecessor_id, successor_id, change_id, kind) VALUES ($1, $2, $3, $4)
        `, [unitId, successor, changeId, change.kind]);
      }
    }
    await store.query(`
      UPDATE unoa.org_change SET state = $2, decided_by = $3, decided_at = now(), decision_note = $4, successor_id = $5
      WHERE id = $1
    `, [changeId, decision === 'approve' ? 'approved' : 'rejected', actor, note, successor]);
    await audit(store, actor, unitId, 'org.change_decided', correlation, changeId);
    return { scopeId: successor && change.kind === 'transfer' ? successor : unitId, id: changeId };
  });
}

export async function publicOrganisation(settings: IamSettings, siteId: string) {
  const store = database(settings);
  const [units, positions] = await Promise.all([
    store.query<{
      id: string; parent_id: string; institution_id: string; institution_label: string;
      label: string; type_label: string; code: string; mission: string | null;
    }>('SELECT * FROM unoa.public_org_units($1)', [siteId]),
    store.query<{ unit_id: string; title: string; is_head: boolean; holder: string; capacity: string }>(
      'SELECT * FROM unoa.public_org_positions($1)', [siteId],
    ),
  ]);
  return { units: units.rows, positions: positions.rows };
}
