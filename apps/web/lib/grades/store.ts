import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { deliberate, GradingError, hasQuorum, outcomeLabels, validatePolicy, type Absence, type GradingPolicy, type UnitInput } from '@unoa/domain/grading';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, integer, list, numeric, optional, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Grades, credits and juries (module GRD). Staff rights on the cohort's owner
// scope; an offering teacher enters the marks of the units their course belongs
// to; jury members deliberate and sign; the president publishes and amends; a
// student sees their published results, appeals and obtains a sealed transcript.

type Right = 'read' | 'policy' | 'enter' | 'validate' | 'jury' | 'appeal';
const sessions = ['first', 'resit'] as const;
const absences = ['none', 'justified', 'unjustified'] as const;
export const sessionLabels: Record<string, string> = { first: 'Première session', resit: 'Seconde session' };
export const roundingLabels: Record<string, string> = { half_up: 'Au plus proche (0,5 vers le haut)', half_even: 'Au plus proche (0,5 vers le pair)', down: 'Par défaut (tronqué)', up: 'Par excès' };
export { outcomeLabels };

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'grd.read', $2) AS read, unoa.has_scope_permission($1, 'grd.policy', $2) AS policy,
      unoa.has_scope_permission($1, 'grd.enter', $2) AS enter, unoa.has_scope_permission($1, 'grd.validate', $2) AS validate,
      unoa.has_scope_permission($1, 'grd.jury', $2) AS jury, unoa.has_scope_permission($1, 'grd.appeal', $2) AS appeal`, [actor, scopeId]);
  return rows[0];
}
async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux responsables habilités des notes et jurys');
  return granted;
}

interface PolicyRow {
  id: string; scope_id: string; program_version_id: string | null; label: string; scale_max: string; pass_mark: string; unit_pass_mark: string; rounding: GradingPolicy['rounding'];
  decimals: number; compensation: boolean; compensation_floor: string | null; resit: boolean; resit_rule: 'best' | 'replace'; jury_quorum: number; appeal_days: number;
  effective_from: string; state: string; author_id: string;
}
const engine = (row: PolicyRow): GradingPolicy => ({
  scaleMax: Number(row.scale_max), passMark: Number(row.pass_mark), unitPassMark: Number(row.unit_pass_mark), rounding: row.rounding, decimals: row.decimals,
  compensation: row.compensation, compensationFloor: row.compensation_floor === null ? null : Number(row.compensation_floor), resit: row.resit, resitRule: row.resit_rule,
});
async function policyById(store: Queryable, id: string) {
  const { rows } = await store.query<PolicyRow>('SELECT *, effective_from::text FROM unoa.grading_policy WHERE id = $1', [id]);
  ensure(rows[0], 404, 'Règle introuvable');
  return rows[0];
}
const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const wrap = <T>(work: () => T) => {
  try { return work(); } catch (error) { if (error instanceof GradingError) throw new Problem(422, error.message); throw error; }
};

// ------------------------------------------------------------------ policies

async function policyAction(store: Queryable, actor: string, action: string, input: Input) {
  if (action === 'policy') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'policy');
    const versionId = optional(input.programVersionId, uuid);
    if (versionId) {
      const { rows } = await store.query(`SELECT 1 FROM unoa.program_version AS version JOIN unoa.program ON program.id = version.program_id
        WHERE version.id = $1 AND unoa.scope_within(program.owner_scope_id, $2)`, [versionId, scopeId]);
      ensure(rows[0], 422, 'La formation relève de cette portée');
    }
    const policy: GradingPolicy = {
      scaleMax: numeric(input.scaleMax), passMark: numeric(input.passMark), unitPassMark: numeric(input.unitPassMark ?? input.passMark),
      rounding: choice(input.rounding, ['half_up', 'half_even', 'down', 'up'] as const, 'Arrondi'), decimals: integer(input.decimals ?? 2, 'Décimales', 0, 3),
      compensation: flag(input.compensation), compensationFloor: flag(input.compensation) ? numeric(input.compensationFloor) : null,
      resit: flag(input.resit), resitRule: choice(input.resitRule ?? 'best', ['best', 'replace'] as const, 'Règle de seconde session'),
    };
    wrap(() => validatePolicy(policy));
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.grading_policy(scope_id, program_version_id, label, scale_max, pass_mark, unit_pass_mark, rounding,
      decimals, compensation, compensation_floor, resit, resit_rule, jury_quorum, appeal_days, effective_from, author_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`, [scopeId, versionId, boundedText(input.label, 160, 'Libellé'),
      policy.scaleMax, policy.passMark, policy.unitPassMark, policy.rounding, policy.decimals, policy.compensation, policy.compensationFloor, policy.resit, policy.resitRule,
      integer(input.juryQuorum, 'Quorum', 1, 50), integer(input.appealDays ?? 15, 'Délai de contestation', 0, 120), day(input.effectiveFrom, 'Date d’effet'), actor]);
    return { scopeId, subject: rows[0].id, policyId: rows[0].id };
  }
  const policy = await policyById(store, uuid(input.policyId));
  await require(store, actor, policy.scope_id, 'policy');
  if (action === 'publish-policy') {
    ensure(policy.state === 'draft', 409, 'Règle déjà publiée');
    ensure(policy.author_id !== actor, 403, 'La publication revient à une autre personne que l’auteur');
    await store.query("UPDATE unoa.grading_policy SET state = 'published', publisher_id = $2, published_at = now() WHERE id = $1", [policy.id, actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Une règle est déjà publiée à cette date pour cette portée');
      throw error;
    });
  } else if (action === 'retire-policy') {
    ensure(policy.state === 'published', 409, 'Seule une règle publiée se retire');
    await store.query("UPDATE unoa.grading_policy SET state = 'retired' WHERE id = $1", [policy.id]);
  } else throw new Problem(404, 'Opération inconnue');
  return { scopeId: policy.scope_id, subject: policy.id, policyId: policy.id };
}

// -------------------------------------------------------------------- grades

async function registrationOf(store: Queryable, id: unknown) {
  const { rows } = await store.query<{ id: string; cohort_id: string; scope_id: string; student_id: string; account_id: string; version_id: string; state: string }>(`
    SELECT registration.id, registration.cohort_id, cohort.owner_scope_id AS scope_id, registration.student_id, student.account_id, cohort.version_id, registration.state
    FROM unoa.registration JOIN unoa.cohort ON cohort.id = registration.cohort_id JOIN unoa.student ON student.id = registration.student_id WHERE registration.id = $1`, [uuid(id)]);
  ensure(rows[0], 404, 'Inscription introuvable');
  ensure(rows[0].state === 'validated', 422, 'Inscription non validée');
  return rows[0];
}
async function teachesUnit(store: Queryable, actor: string, unitId: string) {
  const { rows } = await store.query(`SELECT 1 FROM unoa.unit_course AS link JOIN unoa.course_version AS version ON version.course_id = link.course_id
    JOIN unoa.course_offering AS offering ON offering.course_version_id = version.id WHERE link.unit_id = $1 AND unoa.offering_role(offering.id, $2) = 'teacher' LIMIT 1`, [unitId, actor]);
  return !!rows[0];
}
async function current(store: Queryable, registrationId: string, unitId: string, session: string) {
  const { rows } = await store.query<{ id: string; mark: string | null; absence: Absence; state: string; author_id: string }>(`SELECT id, mark, absence, state, author_id
    FROM unoa.grade_entry WHERE registration_id = $1 AND unit_id = $2 AND session = $3 ORDER BY created_at DESC LIMIT 1`, [registrationId, unitId, session]);
  return rows[0] ?? null;
}

async function gradeAction(store: Queryable, actor: string, action: string, input: Input) {
  const registration = await registrationOf(store, input.registrationId);
  const unitId = uuid(input.unitId);
  const session = choice(input.session ?? 'first', sessions, 'Session');
  const previous = await current(store, registration.id, unitId, session);
  if (action === 'grade') {
    const granted = await rights(store, actor, registration.scope_id);
    ensure(granted?.enter || await teachesUnit(store, actor, unitId), 403, 'Saisie réservée à l’enseignant de l’unité ou au gestionnaire des notes');
    const absence = choice(input.absence || 'none', absences, 'Absence');
    const mark = absence === 'none' ? numeric(input.mark) : null;
    ensure(mark === null || mark >= 0, 400, 'Note négative');
    // A re-evaluation keeps the earlier entry and states why (GRD-012).
    const reason = previous ? boundedText(input.reason, 1000, 'Motif de la modification') : optional(input.reason, text(1000, 'Motif'));
    await store.query(`INSERT INTO unoa.grade_entry(registration_id, unit_id, session, mark, absence, state, reason, supersedes, author_id)
      VALUES ($1, $2, $3, $4, $5, 'provisional', $6, $7, $8)`, [registration.id, unitId, session, mark, absence, reason, previous?.id ?? null, actor]).catch(gradeError);
  } else if (action === 'validate') {
    await require(store, actor, registration.scope_id, 'validate');
    ensure(previous?.state === 'provisional', 409, 'Aucune note provisoire à valider');
    await store.query(`INSERT INTO unoa.grade_entry(registration_id, unit_id, session, mark, absence, state, supersedes, author_id)
      VALUES ($1, $2, $3, $4, $5, 'validated', $6, $7)`, [registration.id, unitId, session, previous.mark, previous.absence, previous.id, actor]).catch(gradeError);
  } else throw new Problem(404, 'Opération inconnue');
  return { scopeId: registration.scope_id, cohortId: registration.cohort_id, subject: registration.id };
}
function gradeError(error: { code?: string; message?: string }): never {
  if (error?.code === '23514' && /scale/.test(error.message ?? '')) throw new Problem(400, 'Note au-dessus de l’échelle');
  if (error?.code === '23514' && /policy/.test(error.message ?? '')) throw new Problem(422, 'Aucune règle de notation publiée pour cette cohorte');
  if (error?.code === '23514' && /registered/.test(error.message ?? '')) throw new Problem(422, 'L’étudiant n’est pas inscrit à cette unité');
  throw error;
}

// Validate every provisional grade of a unit entered by someone else.
async function validateAll(store: Queryable, actor: string, input: Input) {
  const cohortId = uuid(input.cohortId);
  const unitId = uuid(input.unitId);
  const session = choice(input.session ?? 'first', sessions, 'Session');
  const { rows: [cohort] } = await store.query<{ owner_scope_id: string }>('SELECT owner_scope_id FROM unoa.cohort WHERE id = $1', [cohortId]);
  ensure(cohort, 404, 'Cohorte introuvable');
  await require(store, actor, cohort.owner_scope_id, 'validate');
  const { rows } = await store.query<{ id: string; registration_id: string; mark: string | null; absence: string }>(`
    SELECT DISTINCT ON (entry.registration_id) entry.id, entry.registration_id, entry.mark, entry.absence, entry.state, entry.author_id
    FROM unoa.grade_entry AS entry JOIN unoa.registration ON registration.id = entry.registration_id
    WHERE registration.cohort_id = $1 AND entry.unit_id = $2 AND entry.session = $3 ORDER BY entry.registration_id, entry.created_at DESC`, [cohortId, unitId, session]);
  let count = 0;
  for (const row of rows as (typeof rows[number] & { state: string; author_id: string })[]) {
    if (row.state !== 'provisional' || row.author_id === actor) continue;
    await store.query(`INSERT INTO unoa.grade_entry(registration_id, unit_id, session, mark, absence, state, supersedes, author_id) VALUES ($1, $2, $3, $4, $5, 'validated', $6, $7)`,
      [row.registration_id, unitId, session, row.mark, row.absence, row.id, actor]);
    count++;
  }
  return { scopeId: cohort.owner_scope_id, cohortId, subject: cohortId, validated: count };
}

// --------------------------------------------------------------------- juries

interface JuryRow {
  id: string; scope_id: string; cohort_id: string; period_id: string; session: 'first' | 'resit'; label: string; policy_id: string; quorum: number; publish_at: Date;
  state: string; minutes: string | null; minutes_sha256: string | null; published_at: Date | null; deliberated_at: Date | null;
}
async function juryOf(store: Queryable, id: unknown, lock = false) {
  const { rows } = await store.query<JuryRow>(`SELECT * FROM unoa.jury WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Jury introuvable');
  return rows[0];
}
async function membership(store: Queryable, juryId: string, actor: string) {
  const { rows } = await store.query<{ role: string; present: boolean | null }>('SELECT role, present FROM unoa.jury_member WHERE jury_id = $1 AND account_id = $2', [juryId, actor]);
  return rows[0] ?? null;
}
async function president(store: Queryable, jury: JuryRow, actor: string) {
  ensure((await membership(store, jury.id, actor))?.role === 'president', 403, 'Action réservée au président du jury');
}

// Units of the period and, for each validated registration, the inputs of the engine.
async function sheet(store: Queryable, jury: Pick<JuryRow, 'cohort_id' | 'period_id' | 'session'>, onlyValidated: boolean) {
  const { rows: units } = await store.query<{ id: string; code: string; title: string; credits: string; coefficient: string }>(`
    SELECT unit.id, unit.code, unit.title, unit.credits, unit.coefficient FROM unoa.teaching_unit AS unit JOIN unoa.cohort ON cohort.version_id = unit.version_id
    WHERE cohort.id = $1 AND unit.period_id = $2 ORDER BY unit.code`, [jury.cohort_id, jury.period_id]);
  const { rows: registrations } = await store.query<{ id: string; student_id: string; account_id: string; name: string | null; matricule: string; units: string[] }>(`
    SELECT registration.id, registration.student_id, student.account_id, account.display_name AS name, student.matricule,
      array(SELECT unit_id FROM unoa.course_registration WHERE registration_id = registration.id AND state <> 'withdrawn') AS units
    FROM unoa.registration JOIN unoa.student ON student.id = registration.student_id JOIN unoa.account ON account.id = student.account_id
    WHERE registration.cohort_id = $1 AND registration.state = 'validated' ORDER BY student.matricule`, [jury.cohort_id]);
  const { rows: entries } = await store.query<{ registration_id: string; unit_id: string; session: string; mark: string | null; absence: Absence; state: string; author_id: string }>(`
    SELECT DISTINCT ON (entry.registration_id, entry.unit_id, entry.session) entry.registration_id, entry.unit_id, entry.session, entry.mark, entry.absence, entry.state, entry.author_id
    FROM unoa.grade_entry AS entry JOIN unoa.registration ON registration.id = entry.registration_id WHERE registration.cohort_id = $1
    ORDER BY entry.registration_id, entry.unit_id, entry.session, entry.created_at DESC`, [jury.cohort_id]);
  const grade = (registration: string, unit: string, session: string) => entries.find(item => item.registration_id === registration && item.unit_id === unit && item.session === session);
  const inputs = (registrationId: string, registered: string[]): UnitInput[] => units.filter(unit => registered.includes(unit.id)).map(unit => {
    const read = (session: string) => {
      const found = grade(registrationId, unit.id, session);
      if (!found || (onlyValidated && found.state !== 'validated')) return null;
      return { mark: found.mark === null ? null : Number(found.mark), absence: found.absence };
    };
    return { unitId: unit.id, credits: Number(unit.credits), coefficient: Number(unit.coefficient), first: read('first'), resit: jury.session === 'resit' ? read('resit') : null };
  });
  return { units, registrations, entries, grade, inputs };
}

async function juryAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'juries') {
    const cohortId = uuid(input.cohortId);
    const { rows: [cohort] } = await store.query<{ owner_scope_id: string; version_id: string }>('SELECT owner_scope_id, version_id FROM unoa.cohort WHERE id = $1', [cohortId]);
    ensure(cohort, 404, 'Cohorte introuvable');
    await require(store, actor, cohort.owner_scope_id, 'jury');
    const periodId = uuid(input.periodId);
    const { rows: [period] } = await store.query<{ label: string }>('SELECT label FROM unoa.program_period WHERE id = $1 AND version_id = $2', [periodId, cohort.version_id]);
    ensure(period, 422, 'La période appartient à la formation de la cohorte');
    const session = choice(input.session ?? 'first', sessions, 'Session');
    const { rows: [found] } = await store.query<{ id: string | null }>('SELECT unoa.grading_policy_for($1, current_date) AS id', [cohortId]);
    ensure(found.id, 422, 'Aucune règle de notation publiée pour cette cohorte');
    const policy = await policyById(store, found.id);
    if (session === 'resit') {
      ensure(policy.resit, 422, 'La règle en vigueur ne prévoit pas de seconde session');
      const { rows } = await store.query("SELECT 1 FROM unoa.jury WHERE cohort_id = $1 AND period_id = $2 AND session = 'first' AND state = 'published'", [cohortId, periodId]);
      ensure(rows[0], 422, 'La seconde session suit la publication de la première');
    }
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.jury(scope_id, cohort_id, period_id, session, label, policy_id, quorum, publish_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [cohort.owner_scope_id, cohortId, periodId, session,
      optional(input.label, text(200, 'Libellé')) ?? `Jury ${period.label} — ${sessionLabels[session].toLowerCase()}`, policy.id, policy.jury_quorum, utcTime(input.publishAt), actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Un jury existe déjà pour cette période et cette session');
      throw error;
    });
    return { scopeId: cohort.owner_scope_id, juryId: rows[0].id, subject: rows[0].id };
  }
  const jury = await juryOf(store, input.juryId, true);
  const done = (extra: Record<string, unknown> = {}) => ({ scopeId: jury.scope_id, juryId: jury.id, subject: jury.id, ...extra });
  if (action === 'members' || action === 'remove-member') {
    await require(store, actor, jury.scope_id, 'jury');
    ensure(jury.state === 'constituted', 409, 'Composition figée après délibération');
    const accountId = uuid(input.accountId);
    if (action === 'remove-member') await store.query('DELETE FROM unoa.jury_member WHERE jury_id = $1 AND account_id = $2', [jury.id, accountId]);
    else {
      const role = choice(input.role ?? 'member', ['president', 'member'] as const, 'Rôle');
      ensure((await store.query('SELECT 1 FROM unoa.account WHERE id = $1 AND disabled_at IS NULL', [accountId])).rows[0], 404, 'Compte introuvable');
      await store.query('INSERT INTO unoa.jury_member(jury_id, account_id, role, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT (jury_id, account_id) DO UPDATE SET role = EXCLUDED.role',
        [jury.id, accountId, role, actor]).catch(error => {
        if (error?.code === '23505') throw new Problem(409, 'Le jury a déjà un président');
        throw error;
      });
    }
    return done();
  }
  if (action === 'calendar') {
    await require(store, actor, jury.scope_id, 'jury');
    ensure(jury.state !== 'published', 409, 'Résultats déjà publiés');
    await store.query('UPDATE unoa.jury SET publish_at = $2 WHERE id = $1', [jury.id, utcTime(input.publishAt)]);
    return done();
  }
  if (action === 'deliberate') {
    await president(store, jury, actor);
    ensure(jury.state === 'constituted', 409, 'Jury déjà délibéré');
    const present = new Set(list(input.present, 50).map(uuid));
    present.add(actor);
    const { rows: members } = await store.query<{ account_id: string; name: string | null; role: string }>(`SELECT member.account_id, account.display_name AS name, member.role
      FROM unoa.jury_member AS member JOIN unoa.account ON account.id = member.account_id WHERE member.jury_id = $1`, [jury.id]);
    ensure([...present].every(id => members.some(member => member.account_id === id)), 422, 'Seuls les membres du jury sont présents');
    ensure(hasQuorum(present.size, jury.quorum), 422, `Quorum non atteint : ${present.size} présent(s) pour ${jury.quorum} requis`);
    const policyRow = await policyById(store, jury.policy_id);
    const policy = engine(policyRow);
    const data = await sheet(store, jury, true);
    // Students registered to at least one unit of the period.
    let concerned = data.registrations.filter(item => data.units.some(unit => item.units.includes(unit.id)));
    if (jury.session === 'resit') {
      const { rows } = await store.query<{ registration_id: string }>(`SELECT DISTINCT ON (decision.registration_id) decision.registration_id, decision.outcome FROM unoa.jury_decision AS decision
        JOIN unoa.jury ON jury.id = decision.jury_id WHERE jury.cohort_id = $1 AND jury.period_id = $2 AND jury.session = 'first'
        ORDER BY decision.registration_id, decision.created_at DESC`, [jury.cohort_id, jury.period_id]);
      const resit = new Set((rows as { registration_id: string; outcome?: string }[]).filter(row => row.outcome === 'resit').map(row => row.registration_id));
      concerned = concerned.filter(item => resit.has(item.id));
    }
    ensure(concerned.length > 0, 422, 'Aucun étudiant à délibérer');
    // Every grade of a first session is validated before deliberation (GRD-004).
    const unvalidated = data.entries.filter(entry => entry.session === jury.session && entry.state !== 'validated'
      && concerned.some(item => item.id === entry.registration_id) && data.units.some(unit => unit.id === entry.unit_id));
    ensure(unvalidated.length === 0, 422, `${unvalidated.length} note(s) encore provisoire(s)`);
    const decisions = concerned.map(registration => ({ registration, result: wrap(() => deliberate(policy, data.inputs(registration.id, registration.units), jury.session)) }));
    for (const { registration, result } of decisions) {
      await store.query(`INSERT INTO unoa.jury_decision(jury_id, registration_id, average, outcome, credits, units, policy_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [jury.id, registration.id, result.average, result.outcome, result.credits, JSON.stringify(result.units), jury.policy_id]);
    }
    await store.query('UPDATE unoa.jury_member SET present = (account_id = ANY($2::uuid[])) WHERE jury_id = $1', [jury.id, [...present]]);
    const names = members.map(member => `${member.name ?? member.account_id.slice(0, 8)} (${member.role === 'president' ? 'président' : 'membre'}, ${present.has(member.account_id) ? 'présent' : 'absent'})`);
    const minutes = [
      `Procès-verbal — ${jury.label}`, `Règle appliquée : ${policyRow.label} (effet ${policyRow.effective_from}, échelle ${Number(policyRow.scale_max)}, seuil ${Number(policyRow.pass_mark)}, `
        + `compensation ${policyRow.compensation ? 'oui' : 'non'}, arrondi ${policyRow.rounding} à ${policyRow.decimals} décimale(s))`,
      `Quorum : ${present.size} / ${jury.quorum} requis`, `Membres : ${names.join(' ; ')}`, '',
      ...decisions.map(({ registration, result }) => `${registration.matricule} · ${registration.name ?? ''} · moyenne ${result.average ?? '—'} · ${outcomeLabels[result.outcome]} · ${result.credits} crédit(s)`),
      '', optional(input.minutes, text(8000, 'Observations du jury')) ?? 'Sans observation.',
    ].join('\n');
    await store.query("UPDATE unoa.jury SET state = 'deliberated', deliberated_at = now(), minutes = $2, minutes_sha256 = $3 WHERE id = $1", [jury.id, minutes, sha(minutes)]);
    await audit(store, actor, jury.scope_id, 'grd.deliberated', correlation, jury.id);
    return done({ decisions: decisions.length });
  }
  if (action === 'sign') {
    const member = await membership(store, jury.id, actor);
    ensure(member?.present, 403, 'Seuls les membres présents signent le procès-verbal');
    ensure(jury.state === 'deliberated' && jury.minutes_sha256, 409, 'Procès-verbal non signable');
    await store.query('INSERT INTO unoa.jury_signature(jury_id, account_id, sha256) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [jury.id, actor, jury.minutes_sha256]);
    return done();
  }
  if (action === 'publish') {
    await president(store, jury, actor);
    ensure(jury.state === 'deliberated', 409, 'Le jury doit avoir délibéré');
    const { rows: [missing] } = await store.query<{ total: number }>(`SELECT count(*)::int AS total FROM unoa.jury_member AS member WHERE member.jury_id = $1 AND member.present
      AND NOT EXISTS (SELECT 1 FROM unoa.jury_signature WHERE jury_id = member.jury_id AND account_id = member.account_id AND sha256 = $2)`, [jury.id, jury.minutes_sha256]);
    ensure(missing.total === 0, 422, `${missing.total} signature(s) manquante(s) au procès-verbal`);
    const { rows: decisions } = await store.query<{ id: string; registration_id: string; units: { unitId: string; credits: number; passed: boolean; compensated: boolean }[]; student_id: string; account_id: string }>(`
      SELECT decision.id, decision.registration_id, decision.units, registration.student_id, student.account_id FROM unoa.jury_decision AS decision
      JOIN unoa.registration ON registration.id = decision.registration_id JOIN unoa.student ON student.id = registration.student_id WHERE decision.jury_id = $1`, [jury.id]);
    for (const decision of decisions) await award(store, decision.student_id, decision.id, decision.units);
    await store.query("UPDATE unoa.jury SET state = 'published', published_at = now() WHERE id = $1", [jury.id]);
    await audit(store, actor, jury.scope_id, 'grd.published', correlation, jury.id);
    const { rows: [period] } = await store.query<{ label: string }>('SELECT label FROM unoa.program_period WHERE id = $1', [jury.period_id]);
    await dispatch(store, { event: 'grd.results_published', scopeId: jury.scope_id, recipients: decisions.map(item => item.account_id), correlation,
      values: { jury: jury.label, period: period.label }, link: '/resultats' });
    return done();
  }
  if (action === 'rectify') return rectify(store, actor, jury, input, correlation);
  throw new Problem(404, 'Opération inconnue');
}

// Credits of passed or compensated units, unless already capitalised (GRD-005).
async function award(store: Queryable, studentId: string, decisionId: string, units: { unitId: string; credits: number; passed: boolean; compensated: boolean }[]) {
  for (const unit of units.filter(item => (item.passed || item.compensated) && item.credits > 0)) {
    await store.query(`INSERT INTO unoa.credit_award(student_id, unit_id, credits, mode, decision_id) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (student_id, unit_id) WHERE revoked_at IS NULL DO NOTHING`, [studentId, unit.unitId, unit.credits, unit.passed ? 'earned' : 'compensated', decisionId]);
  }
}

// Amendment (GRD-011): new validated grades and a recomputed decision, the earlier
// decision kept, credits revoked or awarded accordingly, signed by the president.
async function rectify(store: Queryable, actor: string, jury: JuryRow, input: Input, correlation: string) {
  await president(store, jury, actor);
  ensure(jury.state !== 'constituted', 409, 'Rectification après délibération seulement');
  const registration = await registrationOf(store, input.registrationId);
  ensure(registration.cohort_id === jury.cohort_id, 422, 'Étudiant hors de ce jury');
  const { rows: [last] } = await store.query<{ id: string; units: { unitId: string; passed: boolean; compensated: boolean }[] }>(
    'SELECT id, units FROM unoa.jury_decision WHERE jury_id = $1 AND registration_id = $2 ORDER BY created_at DESC LIMIT 1', [jury.id, registration.id]);
  ensure(last, 422, 'Aucune décision à rectifier');
  const appealId = optional(input.appealId, uuid);
  if (appealId) {
    const { rows } = await store.query("SELECT 1 FROM unoa.grade_appeal AS appeal JOIN unoa.jury_decision AS decision ON decision.id = appeal.decision_id WHERE appeal.id = $1 AND appeal.state = 'upheld' AND decision.jury_id = $2 AND decision.registration_id = $3",
      [appealId, jury.id, registration.id]);
    ensure(rows[0], 422, 'Contestation fondée requise');
  }
  const id = randomUUID();
  await store.query('INSERT INTO unoa.rectification(id, jury_id, registration_id, appeal_id, reason, decided_by) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, jury.id, registration.id, appealId, boundedText(input.reason, 4000, 'Motif de la rectification'), actor]);
  const policy = engine(await policyById(store, jury.policy_id));
  const data = await sheet(store, jury, true);
  let changed = 0;
  for (const unit of data.units) {
    const value = input['m.' + unit.id];
    if (value === undefined || value === '') continue;
    const mark = numeric(value);
    ensure(mark >= 0 && mark <= policy.scaleMax, 400, 'Note hors de l’échelle');
    await store.query(`INSERT INTO unoa.grade_entry(registration_id, unit_id, session, mark, absence, state, reason, rectification_id, author_id)
      VALUES ($1, $2, $3, $4, 'none', 'validated', 'Rectification', $5, $6)`, [registration.id, unit.id, jury.session, mark, id, actor]).catch(gradeError);
    changed++;
  }
  ensure(changed > 0, 400, 'Indiquez au moins une note rectifiée');
  const fresh = await sheet(store, jury, true);
  const row = fresh.registrations.find(item => item.id === registration.id)!;
  const result = wrap(() => deliberate(policy, fresh.inputs(registration.id, row.units), jury.session));
  const decisionId = randomUUID();
  await store.query(`INSERT INTO unoa.jury_decision(id, jury_id, registration_id, average, outcome, credits, units, policy_id, amends, rectification_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [decisionId, jury.id, registration.id, result.average, result.outcome, result.credits, JSON.stringify(result.units), jury.policy_id, last.id, id]);
  const fingerprint = sha({ rectification: id, decision: decisionId, result });
  await store.query('INSERT INTO unoa.jury_signature(jury_id, account_id, sha256, rectification_id) VALUES ($1, $2, $3, $4)', [jury.id, actor, fingerprint, id]);
  if (jury.state === 'published') {
    // An award no longer justified, or justified differently (compensated → earned), is revoked and replaced.
    const keep = result.units.filter(unit => unit.passed || unit.compensated).map(unit => unit.unitId + ':' + (unit.passed ? 'earned' : 'compensated'));
    await store.query(`UPDATE unoa.credit_award SET revoked_at = now(), revoked_by = $3 WHERE student_id = $1 AND revoked_at IS NULL
      AND decision_id IN (SELECT id FROM unoa.jury_decision WHERE jury_id = $2 AND registration_id = $4) AND NOT ((unit_id::text || ':' || mode) = ANY($5::text[]))`,
      [registration.student_id, jury.id, id, registration.id, keep]);
    await award(store, registration.student_id, decisionId, result.units);
  }
  await audit(store, actor, jury.scope_id, 'grd.rectified', correlation, id);
  await dispatch(store, { event: 'grd.rectified', scopeId: jury.scope_id, recipients: [registration.account_id], correlation, values: { jury: jury.label }, link: '/resultats' });
  return { scopeId: jury.scope_id, juryId: jury.id, subject: id, rectificationId: id, outcome: result.outcome };
}

// -------------------------------------------------------------------- appeals

async function appealAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'appeal') {
    const { rows: [decision] } = await store.query<{ id: string; account_id: string; state: string; published_at: Date | null; publish_at: Date; appeal_days: number; scope_id: string; latest: boolean }>(`
      SELECT decision.id, student.account_id, jury.state, jury.published_at, jury.publish_at, policy.appeal_days, jury.scope_id,
        NOT EXISTS (SELECT 1 FROM unoa.jury_decision AS later WHERE later.amends = decision.id) AS latest
      FROM unoa.jury_decision AS decision JOIN unoa.jury ON jury.id = decision.jury_id JOIN unoa.grading_policy AS policy ON policy.id = decision.policy_id
      JOIN unoa.registration ON registration.id = decision.registration_id JOIN unoa.student ON student.id = registration.student_id WHERE decision.id = $1`, [uuid(input.decisionId)]);
    ensure(decision, 404, 'Décision introuvable');
    ensure(decision.account_id === actor, 403, 'Contestation réservée à l’étudiant concerné');
    const visible = decision.state === 'published' && decision.publish_at.getTime() <= Date.now();
    ensure(visible && decision.latest, 409, 'Résultat non publié ou déjà rectifié');
    const start = Math.max(decision.publish_at.getTime(), decision.published_at!.getTime());
    ensure(Date.now() <= start + decision.appeal_days * 86_400_000, 409, 'Délai de contestation expiré');
    const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.grade_appeal(decision_id, appellant_id, reason) VALUES ($1, $2, $3) RETURNING id',
      [decision.id, actor, boundedText(input.reason, 4000, 'Motif de la contestation')]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Une contestation est déjà en cours');
      throw error;
    });
    await audit(store, actor, decision.scope_id, 'grd.appeal_filed', correlation, rows[0].id);
    return { appealId: rows[0].id };
  }
  if (action === 'decide-appeal') {
    const { rows: [appeal] } = await store.query<{ id: string; state: string; appellant_id: string; scope_id: string; label: string; jury_id: string }>(`
      SELECT appeal.id, appeal.state, appeal.appellant_id, jury.scope_id, jury.label, jury.id AS jury_id FROM unoa.grade_appeal AS appeal
      JOIN unoa.jury_decision AS decision ON decision.id = appeal.decision_id JOIN unoa.jury ON jury.id = decision.jury_id WHERE appeal.id = $1 FOR UPDATE OF appeal`, [uuid(input.appealId)]);
    ensure(appeal, 404, 'Contestation introuvable');
    await require(store, actor, appeal.scope_id, 'appeal');
    ensure(appeal.appellant_id !== actor, 403, 'Un étudiant ne statue pas sur sa propre contestation');
    ensure(appeal.state === 'filed', 409, 'Contestation déjà tranchée');
    const outcome = choice(input.outcome, ['rejected', 'upheld'] as const, 'Issue');
    await store.query('UPDATE unoa.grade_appeal SET state = $2, response = $3, decided_by = $4, decided_at = now() WHERE id = $1',
      [appeal.id, outcome, boundedText(input.response, 4000, 'Réponse motivée'), actor]);
    await audit(store, actor, appeal.scope_id, 'grd.appeal_' + outcome, correlation, appeal.id);
    await dispatch(store, { event: 'grd.appeal_decided', scopeId: appeal.scope_id, recipients: [appeal.appellant_id], correlation,
      values: { jury: appeal.label, outcome: outcome === 'upheld' ? 'contestation fondée, rectification à venir' : 'contestation rejetée' }, link: '/resultats' });
    return { scopeId: appeal.scope_id, juryId: appeal.jury_id, subject: appeal.id };
  }
  throw new Problem(404, 'Opération inconnue');
}

export async function grdAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.grd.' + action, async store => {
    let result: { scopeId?: string; subject?: string; [key: string]: unknown };
    if (['policy', 'publish-policy', 'retire-policy'].includes(action)) result = await policyAction(store, actor, action, input);
    else if (action === 'grade' || action === 'validate') result = await gradeAction(store, actor, action, input);
    else if (action === 'validate-all') result = await validateAll(store, actor, input);
    else if (['juries', 'members', 'remove-member', 'calendar', 'deliberate', 'sign', 'publish', 'rectify'].includes(action)) result = await juryAction(store, actor, action, input, correlation);
    else if (action === 'appeal' || action === 'decide-appeal') return appealAction(store, actor, action, input, correlation);
    else throw new Problem(404, 'Opération inconnue');
    if (!['deliberate', 'publish', 'rectify'].includes(action)) await audit(store, actor, result.scopeId ?? null, 'grd.' + action.replace(/-/g, '_'), correlation, result.subject ?? null);
    return result;
  });
}

// ---------------------------------------------------------------------- views

export async function grdContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`
    SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('territory', 'institution', 'academic_unit') AND unoa.has_scope_permission($1, 'grd.read', scope.id) ORDER BY kind.nature, scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function grdOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const [label, policies, cohorts, juries, appeals, versions] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<PolicyRow & { scope_label: string; version_title: string | null }>(`
      WITH RECURSIVE ancestry AS (SELECT id, parent_id FROM unoa.scope WHERE id = $1 UNION ALL SELECT scope.id, scope.parent_id FROM unoa.scope JOIN ancestry ON scope.id = ancestry.parent_id)
      SELECT policy.*, policy.effective_from::text, scope.label AS scope_label, version.title AS version_title FROM unoa.grading_policy AS policy
      JOIN unoa.scope ON scope.id = policy.scope_id LEFT JOIN unoa.program_version AS version ON version.id = policy.program_version_id
      WHERE policy.scope_id IN (SELECT id FROM ancestry) OR unoa.scope_within(policy.scope_id, $1) ORDER BY policy.effective_from DESC, policy.created_at DESC LIMIT 100`, [scopeId]),
    store.query<{ id: string; code: string; label: string; academic_year: string; version_title: string; policy_id: string | null;
      periods: { id: string; label: string }[] }>(`
      SELECT cohort.id, cohort.code, cohort.label, cohort.academic_year, version.title AS version_title, unoa.grading_policy_for(cohort.id, current_date) AS policy_id,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label) ORDER BY ordinal) FROM unoa.program_period WHERE version_id = cohort.version_id), '[]') AS periods
      FROM unoa.cohort JOIN unoa.program_version AS version ON version.id = cohort.version_id WHERE unoa.scope_within(cohort.owner_scope_id, $1) ORDER BY cohort.academic_year DESC, cohort.code LIMIT 200`, [scopeId]),
    store.query<{ id: string; label: string; session: string; state: string; publish_at: Date; cohort: string; decisions: number }>(`
      SELECT jury.id, jury.label, jury.session, jury.state, jury.publish_at, cohort.label AS cohort,
        (SELECT count(DISTINCT registration_id)::int FROM unoa.jury_decision WHERE jury_id = jury.id) AS decisions
      FROM unoa.jury JOIN unoa.cohort ON cohort.id = jury.cohort_id WHERE unoa.scope_within(jury.scope_id, $1) ORDER BY jury.created_at DESC LIMIT 200`, [scopeId]),
    store.query<{ id: string; name: string | null; reason: string; filed_at: Date; state: string; response: string | null; jury_label: string; jury_id: string }>(`
      SELECT appeal.id, account.display_name AS name, appeal.reason, appeal.filed_at, appeal.state, appeal.response, jury.label AS jury_label, jury.id AS jury_id
      FROM unoa.grade_appeal AS appeal JOIN unoa.jury_decision AS decision ON decision.id = appeal.decision_id JOIN unoa.jury ON jury.id = decision.jury_id
      JOIN unoa.account ON account.id = appeal.appellant_id WHERE unoa.scope_within(jury.scope_id, $1) ORDER BY appeal.filed_at DESC LIMIT 200`, [scopeId]),
    store.query<{ id: string; title: string }>(`SELECT version.id, program.title || ' — v' || version.number AS title FROM unoa.program_version AS version
      JOIN unoa.program ON program.id = version.program_id WHERE unoa.scope_within(program.owner_scope_id, $1) AND version.state = 'published' ORDER BY program.title LIMIT 200`, [scopeId]),
  ]);
  ensure(label.rows[0], 404, 'Portée introuvable');
  return { scope: { id: scopeId, label: label.rows[0].label }, rights: granted, policies: policies.rows, cohorts: cohorts.rows, juries: juries.rows, appeals: appeals.rows, versions: versions.rows };
}

// Grade sheet of a cohort and period: units, students, current grade per session.
export async function gradeSheet(settings: IamSettings, actor: string, cohortId: string, periodId: string) {
  const store = database(settings);
  const { rows: [cohort] } = await store.query<{ id: string; label: string; owner_scope_id: string; version_id: string }>('SELECT id, label, owner_scope_id, version_id FROM unoa.cohort WHERE id = $1', [uuid(cohortId)]);
  ensure(cohort, 404, 'Cohorte introuvable');
  const granted = await rights(store, actor, cohort.owner_scope_id);
  const { rows: [period] } = await store.query<{ id: string; label: string }>('SELECT id, label FROM unoa.program_period WHERE id = $1 AND version_id = $2', [uuid(periodId), cohort.version_id]);
  ensure(period, 404, 'Période introuvable');
  const data = await sheet(store, { cohort_id: cohort.id, period_id: period.id, session: 'resit' }, false);
  const teaching = new Set<string>();
  for (const unit of data.units) if (await teachesUnit(store, actor, unit.id)) teaching.add(unit.id);
  ensure(granted?.read || teaching.size > 0, 403, 'Relevé de notes réservé');
  const { rows: [policy] } = await store.query<{ id: string | null }>('SELECT unoa.grading_policy_for($1, current_date) AS id', [cohort.id]);
  return {
    cohort, period, rights: granted, teaching: [...teaching], policy: policy.id ? await policyById(store, policy.id) : null,
    units: data.units, registrations: data.registrations, entries: data.entries.filter(entry => data.units.some(unit => unit.id === entry.unit_id)),
  };
}

export async function gradeHistory(settings: IamSettings, actor: string, registrationId: string, unitId: string) {
  const store = database(settings);
  const registration = await registrationOf(store, registrationId);
  ensure((await rights(store, actor, registration.scope_id))?.read || registration.account_id === actor, 403, 'Historique réservé');
  const { rows } = await store.query(`SELECT entry.session, entry.mark, entry.absence, entry.state, entry.reason, entry.created_at, account.display_name AS author, entry.rectification_id
    FROM unoa.grade_entry AS entry JOIN unoa.account ON account.id = entry.author_id WHERE entry.registration_id = $1 AND entry.unit_id = $2 ORDER BY entry.created_at`, [registration.id, uuid(unitId)]);
  return rows;
}

export async function juryDetails(settings: IamSettings, actor: string, juryId: string) {
  const store = database(settings);
  const jury = await juryOf(store, juryId);
  const granted = await rights(store, actor, jury.scope_id);
  const member = await membership(store, jury.id, actor);
  ensure(granted?.read || member, 403, 'Jury réservé à ses membres et aux responsables');
  const [members, decisions, signatures, rectifications, policy, cohort, period, appeals] = await Promise.all([
    store.query<{ account_id: string; name: string | null; role: string; present: boolean | null }>(`SELECT member.account_id, account.display_name AS name, member.role, member.present
      FROM unoa.jury_member AS member JOIN unoa.account ON account.id = member.account_id WHERE member.jury_id = $1 ORDER BY member.role DESC, account.display_name`, [jury.id]),
    store.query<{ id: string; registration_id: string; name: string | null; matricule: string; average: string | null; outcome: string; credits: string; units: { unitId: string; mark: number | null; passed: boolean; compensated: boolean }[];
      amends: string | null; created_at: Date; superseded: boolean }>(`
      SELECT decision.id, decision.registration_id, account.display_name AS name, student.matricule, decision.average, decision.outcome, decision.credits, decision.units,
        decision.amends, decision.created_at, EXISTS (SELECT 1 FROM unoa.jury_decision AS later WHERE later.amends = decision.id) AS superseded
      FROM unoa.jury_decision AS decision JOIN unoa.registration ON registration.id = decision.registration_id JOIN unoa.student ON student.id = registration.student_id
      JOIN unoa.account ON account.id = student.account_id WHERE decision.jury_id = $1 ORDER BY student.matricule, decision.created_at`, [jury.id]),
    store.query<{ account_id: string; name: string | null; sha256: string; signed_at: Date; rectification_id: string | null }>(`SELECT signature.account_id, account.display_name AS name,
      signature.sha256, signature.signed_at, signature.rectification_id FROM unoa.jury_signature AS signature JOIN unoa.account ON account.id = signature.account_id
      WHERE signature.jury_id = $1 ORDER BY signature.signed_at`, [jury.id]),
    store.query<{ id: string; reason: string; created_at: Date; name: string | null }>(`SELECT rectification.id, rectification.reason, rectification.created_at, account.display_name AS name
      FROM unoa.rectification JOIN unoa.registration ON registration.id = rectification.registration_id JOIN unoa.student ON student.id = registration.student_id
      JOIN unoa.account ON account.id = student.account_id WHERE rectification.jury_id = $1 ORDER BY rectification.created_at`, [jury.id]),
    policyById(store, jury.policy_id),
    store.query<{ label: string }>('SELECT label FROM unoa.cohort WHERE id = $1', [jury.cohort_id]),
    store.query<{ label: string }>('SELECT label FROM unoa.program_period WHERE id = $1', [jury.period_id]),
    store.query<{ id: string; decision_id: string; name: string | null; reason: string; state: string; response: string | null }>(`
      SELECT appeal.id, appeal.decision_id, account.display_name AS name, appeal.reason, appeal.state, appeal.response FROM unoa.grade_appeal AS appeal
      JOIN unoa.jury_decision AS decision ON decision.id = appeal.decision_id JOIN unoa.account ON account.id = appeal.appellant_id WHERE decision.jury_id = $1`, [jury.id]),
  ]);
  const { rows: units } = await store.query<{ id: string; code: string; title: string }>('SELECT id, code, title FROM unoa.teaching_unit WHERE period_id = $1 ORDER BY code', [jury.period_id]);
  // People who can sit on the jury: staff of the scope and teachers of its offerings.
  const { rows: candidates } = granted?.jury && jury.state === 'constituted' ? await store.query<{ id: string; name: string | null }>(`
    SELECT DISTINCT account.id, account.display_name AS name FROM unoa.account WHERE account.disabled_at IS NULL AND (
      EXISTS (SELECT 1 FROM unoa.role_grant AS grant_row WHERE grant_row.account_id = account.id AND grant_row.revoked_at IS NULL
        AND (grant_row.effective_until IS NULL OR grant_row.effective_until > now()) AND (unoa.scope_within(grant_row.scope_id, $1) OR unoa.scope_within($1, grant_row.scope_id)))
      OR EXISTS (SELECT 1 FROM unoa.offering_member AS member JOIN unoa.course_offering AS offering ON offering.id = member.offering_id
        WHERE member.account_id = account.id AND member.role = 'teacher' AND member.removed_at IS NULL AND unoa.scope_within(offering.owner_scope_id, $1)))
    ORDER BY account.display_name LIMIT 300`, [jury.scope_id]) : { rows: [] };
  return { candidates, jury, rights: granted, member, members: members.rows, decisions: decisions.rows, signatures: signatures.rows, rectifications: rectifications.rows, policy,
    cohort: cohort.rows[0].label, period: period.rows[0].label, appeals: appeals.rows, units };
}

// Invariants (GRD-014): every anomaly found, without changing anything.
export async function invariants(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  await require(store, actor, scopeId, 'read');
  const { rows } = await store.query<{ kind: string; detail: string }>(`
    WITH awards AS (
      SELECT award.*, student.matricule FROM unoa.credit_award AS award JOIN unoa.student ON student.id = award.student_id
      JOIN unoa.jury_decision AS decision ON decision.id = award.decision_id JOIN unoa.jury ON jury.id = decision.jury_id
      WHERE award.revoked_at IS NULL AND unoa.scope_within(jury.scope_id, $1))
    SELECT 'credits_over_programme' AS kind, matricule || ' : ' || sum(awards.credits) || ' crédits pour ' || max(version.expected_credits) || ' attendus' AS detail
      FROM awards JOIN unoa.teaching_unit AS unit ON unit.id = awards.unit_id JOIN unoa.program_version AS version ON version.id = unit.version_id
      GROUP BY matricule, version.id HAVING max(version.expected_credits) IS NOT NULL AND sum(awards.credits) > max(version.expected_credits)
    UNION ALL
    SELECT 'credit_without_validation', awards.matricule || ' : ' || unit.code || ' sans unité validée dans la décision'
      FROM awards JOIN unoa.teaching_unit AS unit ON unit.id = awards.unit_id JOIN unoa.jury_decision AS decision ON decision.id = awards.decision_id
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(decision.units) AS item WHERE item->>'unitId' = awards.unit_id::text
        AND ((item->>'passed')::boolean OR (item->>'compensated')::boolean))
    UNION ALL
    SELECT 'published_unsigned', jury.label || ' : publié sans toutes les signatures des présents'
      FROM unoa.jury WHERE jury.state = 'published' AND unoa.scope_within(jury.scope_id, $1) AND EXISTS (SELECT 1 FROM unoa.jury_member AS member
        WHERE member.jury_id = jury.id AND member.present AND NOT EXISTS (SELECT 1 FROM unoa.jury_signature WHERE jury_id = jury.id AND account_id = member.account_id AND sha256 = jury.minutes_sha256))
    UNION ALL
    SELECT 'grade_changed_after_deliberation', jury.label || ' : note modifiée après délibération sans rectification'
      FROM unoa.jury JOIN unoa.registration ON registration.cohort_id = jury.cohort_id JOIN unoa.grade_entry AS entry ON entry.registration_id = registration.id
      JOIN unoa.teaching_unit AS unit ON unit.id = entry.unit_id AND unit.period_id = jury.period_id
      WHERE jury.state <> 'constituted' AND unoa.scope_within(jury.scope_id, $1) AND entry.session = jury.session AND entry.created_at > jury.deliberated_at AND entry.rectification_id IS NULL
    UNION ALL
    SELECT 'resit_without_first', jury.label || ' : seconde session sans première session publiée'
      FROM unoa.jury WHERE jury.session = 'resit' AND unoa.scope_within(jury.scope_id, $1) AND NOT EXISTS (SELECT 1 FROM unoa.jury AS first
        WHERE first.cohort_id = jury.cohort_id AND first.period_id = jury.period_id AND first.session = 'first' AND first.state = 'published')
    LIMIT 500`, [scopeId]);
  // Recomputation: every current decision equals what the policy gives on the validated grades.
  const { rows: juries } = await store.query<{ id: string }>("SELECT id FROM unoa.jury WHERE state <> 'constituted' AND unoa.scope_within(scope_id, $1) LIMIT 100", [scopeId]);
  const drift: { kind: string; detail: string }[] = [];
  for (const { id } of juries) {
    const jury = await juryOf(store, id);
    const policy = engine(await policyById(store, jury.policy_id));
    const data = await sheet(store, jury, true);
    const { rows: decisions } = await store.query<{ registration_id: string; outcome: string; credits: string; average: string | null }>(`
      SELECT decision.registration_id, decision.outcome, decision.credits, decision.average FROM unoa.jury_decision AS decision
      WHERE decision.jury_id = $1 AND NOT EXISTS (SELECT 1 FROM unoa.jury_decision AS later WHERE later.amends = decision.id)`, [jury.id]);
    for (const decision of decisions) {
      const registration = data.registrations.find(item => item.id === decision.registration_id);
      if (!registration || !data.units.some(unit => registration.units.includes(unit.id))) continue;
      const result = wrap(() => deliberate(policy, data.inputs(registration.id, registration.units), jury.session));
      if (result.outcome !== decision.outcome || result.credits !== Number(decision.credits) || (result.average ?? null) !== (decision.average === null ? null : Number(decision.average))) {
        drift.push({ kind: 'decision_differs_from_rules', detail: `${jury.label} : ${registration.matricule} — décision enregistrée ${outcomeLabels[decision.outcome as keyof typeof outcomeLabels]}, recalcul ${outcomeLabels[result.outcome]}` });
      }
    }
  }
  return [...rows, ...drift];
}

// --------------------------------------------------------------- student side

const visibleJury = "jury.state = 'published' AND jury.publish_at <= now()";

export async function myResults(settings: IamSettings, actor: string) {
  const store = database(settings);
  const { rows: decisions } = await store.query<{ id: string; jury_label: string; session: string; period: string; average: string | null; outcome: string; credits: string;
    units: { unitId: string; mark: number | null; passed: boolean; compensated: boolean; credits: number }[]; scale_max: string; policy_label: string; institution: string;
    program: string; published_at: Date; appeal_until: Date; rectified: boolean;
    appeal: { id: string; state: string; response: string | null } | null }>(`
    SELECT decision.id, jury.label AS jury_label, jury.session, period.label AS period, decision.average, decision.outcome, decision.credits, decision.units,
      policy.scale_max, policy.label AS policy_label, institution.label AS institution, version.title AS program, greatest(jury.published_at, jury.publish_at) AS published_at,
      greatest(jury.published_at, jury.publish_at) + make_interval(days => policy.appeal_days) AS appeal_until, decision.amends IS NOT NULL AS rectified,
      (SELECT jsonb_build_object('id', appeal.id, 'state', appeal.state, 'response', appeal.response) FROM unoa.grade_appeal AS appeal
        JOIN unoa.jury_decision AS any_decision ON any_decision.id = appeal.decision_id WHERE any_decision.jury_id = jury.id AND any_decision.registration_id = decision.registration_id
        ORDER BY appeal.filed_at DESC LIMIT 1) AS appeal
    FROM unoa.jury_decision AS decision JOIN unoa.jury ON jury.id = decision.jury_id JOIN unoa.program_period AS period ON period.id = jury.period_id
    JOIN unoa.grading_policy AS policy ON policy.id = decision.policy_id JOIN unoa.registration ON registration.id = decision.registration_id
    JOIN unoa.student ON student.id = registration.student_id JOIN unoa.scope AS institution ON institution.id = student.institution_id
    JOIN unoa.cohort ON cohort.id = registration.cohort_id JOIN unoa.program_version AS version ON version.id = cohort.version_id
    WHERE student.account_id = $1 AND ${visibleJury} AND NOT EXISTS (SELECT 1 FROM unoa.jury_decision AS later WHERE later.amends = decision.id)
    ORDER BY jury.published_at`, [actor]);
  const { rows: units } = await store.query<{ id: string; code: string; title: string }>(`SELECT id, code, title FROM unoa.teaching_unit WHERE id = ANY($1::uuid[])`,
    [[...new Set(decisions.flatMap(item => item.units.map(unit => unit.unitId)))]]);
  const { rows: credits } = await store.query<{ total: string | null }>(`SELECT sum(award.credits) AS total FROM unoa.credit_award AS award JOIN unoa.student ON student.id = award.student_id
    JOIN unoa.jury_decision AS decision ON decision.id = award.decision_id JOIN unoa.jury ON jury.id = decision.jury_id
    WHERE student.account_id = $1 AND award.revoked_at IS NULL AND ${visibleJury}`, [actor]);
  return { decisions, units, credits: Number(credits[0]?.total ?? 0) };
}

// Transcript (GRD-013): built from published decisions and credits only, sealed and kept.
export async function issueTranscript(settings: IamSettings, actor: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.grd.transcript.' + actor, async store => {
    const studentId = optional(input.studentId, uuid);
    const { rows: [student] } = await store.query<{ id: string; account_id: string; matricule: string; name: string | null; institution_id: string; institution: string }>(`
      SELECT student.id, student.account_id, student.matricule, account.display_name AS name, student.institution_id, institution.label AS institution FROM unoa.student
      JOIN unoa.account ON account.id = student.account_id JOIN unoa.scope AS institution ON institution.id = student.institution_id
      WHERE ${studentId ? 'student.id = $1' : 'student.account_id = $1'} ORDER BY student.created_at LIMIT 1`, [studentId ?? actor]);
    ensure(student, 404, 'Dossier étudiant introuvable');
    if (student.account_id !== actor) await require(store, actor, student.institution_id, 'read');
    const { rows: periods } = await store.query(`
      SELECT version.title AS program, period.label AS period, jury.session, jury.label AS jury, decision.average, decision.outcome, decision.credits, policy.label AS policy,
        policy.scale_max, decision.id AS decision,
        (SELECT jsonb_agg(jsonb_build_object('code', unit.code, 'title', unit.title, 'credits', unit.credits, 'mark', item->'mark', 'passed', item->'passed', 'compensated', item->'compensated') ORDER BY unit.code)
          FROM jsonb_array_elements(decision.units) AS item JOIN unoa.teaching_unit AS unit ON unit.id = (item->>'unitId')::uuid) AS units
      FROM unoa.jury_decision AS decision JOIN unoa.jury ON jury.id = decision.jury_id JOIN unoa.program_period AS period ON period.id = jury.period_id
      JOIN unoa.grading_policy AS policy ON policy.id = decision.policy_id JOIN unoa.registration ON registration.id = decision.registration_id
      JOIN unoa.cohort ON cohort.id = registration.cohort_id JOIN unoa.program_version AS version ON version.id = cohort.version_id
      WHERE registration.student_id = $1 AND ${visibleJury} AND NOT EXISTS (SELECT 1 FROM unoa.jury_decision AS later WHERE later.amends = decision.id)
      ORDER BY period.ordinal, jury.session`, [student.id]);
    const { rows: [total] } = await store.query<{ total: string | null }>(`SELECT sum(award.credits) AS total FROM unoa.credit_award AS award
      JOIN unoa.jury_decision AS decision ON decision.id = award.decision_id JOIN unoa.jury ON jury.id = decision.jury_id
      WHERE award.student_id = $1 AND award.revoked_at IS NULL AND ${visibleJury}`, [student.id]);
    ensure(periods.length > 0, 422, 'Aucun résultat publié');
    const content = { format: 'unoa.transcript/1', institution: student.institution, student: { matricule: student.matricule, name: student.name },
      issuedAt: new Date().toISOString(), periods, credits: Number(total.total ?? 0), notice: 'Relevé de notes interne — ne constitue pas un diplôme.' };
    const seal = sha(content);
    await store.query('INSERT INTO unoa.transcript(student_id, content, sha256, issued_by) VALUES ($1, $2, $3, $4)', [student.id, JSON.stringify(content), seal, actor]);
    await audit(store, actor, student.institution_id, 'grd.transcript_issued', correlation, student.id);
    return { ...content, seal };
  });
}

export async function verifyTranscript(settings: IamSettings, actor: string, seal: string) {
  ensure(/^[0-9a-f]{64}$/.test(seal), 400, 'Empreinte invalide');
  const store = database(settings);
  const { rows: [found] } = await store.query<{ content: Record<string, unknown>; issued_at: Date; institution_id: string; account_id: string }>(`
    SELECT transcript.content, transcript.issued_at, student.institution_id, student.account_id FROM unoa.transcript JOIN unoa.student ON student.id = transcript.student_id WHERE transcript.sha256 = $1`, [seal]);
  ensure(found, 404, 'Relevé inconnu');
  ensure(found.account_id === actor || (await rights(store, actor, found.institution_id))?.read, 403, 'Vérification réservée');
  // The seal is unique and the row append-only: finding it proves the issue.
  return { valid: true, issuedAt: found.issued_at, content: found.content };
}
