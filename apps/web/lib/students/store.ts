import 'server-only';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, businessCode, choice, day, ensure, integer, optional, Problem, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Student records (module SIS). Rights are checked on the institution of the
// cohort or of the student; a student reaches only their own record.

type Right = 'read' | 'manage' | 'enrol' | 'validate' | 'status';
const statusLabels: Record<string, string> = {
  active: 'Actif', suspended: 'Suspendu', interrupted: 'Interrompu', graduated: 'Diplômé', withdrawn: 'Sorti',
};
const transitions: Record<string, { from: string[]; to: string }> = {
  suspend: { from: ['active'], to: 'suspended' }, resume: { from: ['suspended', 'interrupted'], to: 'active' },
  interrupt: { from: ['active', 'suspended'], to: 'interrupted' }, withdraw: { from: ['active', 'suspended', 'interrupted'], to: 'withdrawn' },
  graduate: { from: ['active'], to: 'graduated' },
};
const academicYear = (value: unknown) => {
  ensure(typeof value === 'string' && /^\d{4}-\d{4}$/.test(value) && Number(value.slice(5)) === Number(value.slice(0, 4)) + 1, 400, 'Année académique AAAA-AAAA');
  return value;
};

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'sis.read', $2) AS read, unoa.has_scope_permission($1, 'sis.manage', $2) AS manage,
           unoa.has_scope_permission($1, 'sis.enrol', $2) AS enrol, unoa.has_scope_permission($1, 'sis.validate', $2) AS validate,
           unoa.has_scope_permission($1, 'sis.status', $2) AS status
  `, [actor, scopeId]);
  return rows[0];
}

async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée à la scolarité habilitée');
  return granted;
}

export async function sisContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`
    SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature = 'institution' AND unoa.has_scope_permission($1, 'sis.read', scope.id) ORDER BY scope.label LIMIT 200
  `, [actor]);
  return rows;
}

export async function sisOverview(settings: IamSettings, actor: string, institution: string, search?: string) {
  const institutionId = uuid(institution);
  const store = database(settings);
  const granted = await require(store, actor, institutionId, 'read');
  const query = search?.trim() ? '%' + search.trim().slice(0, 80) + '%' : null;
  const [scope, rule, versions, cohorts, admitted, students, pending] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [institutionId]),
    store.query<{ pattern: string; next_value: string }>('SELECT pattern, next_value FROM unoa.matricule_rule WHERE institution_id = $1', [institutionId]),
    store.query<{ id: string; code: string; title: string; number: number }>(`
      SELECT version.id, program.code, version.title, version.number FROM unoa.program_version AS version
      JOIN unoa.program ON program.id = version.program_id WHERE program.institution_id = $1 AND version.state = 'published' ORDER BY program.code`, [institutionId]),
    store.query<{ id: string; code: string; label: string; academic_year: string; starts_on: string; ends_on: string; capacity: number | null;
      state: string; program_code: string; version_id: string; registered: number; groups: string[] }>(`
      SELECT cohort.id, cohort.code, cohort.label, cohort.academic_year, cohort.starts_on::text, cohort.ends_on::text, cohort.capacity, cohort.state,
        program.code AS program_code, cohort.version_id,
        (SELECT count(*)::int FROM unoa.registration WHERE cohort_id = cohort.id AND state <> 'cancelled') AS registered,
        coalesce((SELECT array_agg(label ORDER BY label) FROM unoa.cohort_group WHERE cohort_id = cohort.id), '{}') AS groups
      FROM unoa.cohort JOIN unoa.program_version AS version ON version.id = cohort.version_id JOIN unoa.program ON program.id = version.program_id
      WHERE cohort.institution_id = $1 ORDER BY cohort.academic_year DESC, cohort.code`, [institutionId]),
    store.query<{ id: string; receipt: string; applicant_id: string; name: string | null; program_title: string; version_id: string }>(`
      SELECT application.id, application.receipt, application.applicant_id, account.display_name AS name, version.title AS program_title, version.id AS version_id
      FROM unoa.application JOIN unoa.admission_round AS round ON round.id = application.round_id
      JOIN unoa.program_version AS version ON version.id = round.version_id JOIN unoa.program ON program.id = version.program_id
      JOIN unoa.account ON account.id = application.applicant_id
      WHERE program.institution_id = $1 AND application.state = 'accepted'
        AND NOT EXISTS (SELECT 1 FROM unoa.student WHERE application_id = application.id) ORDER BY application.updated_at LIMIT 200`, [institutionId]),
    store.query<{ id: string; matricule: string; status: string; name: string | null; created_at: Date }>(`
      SELECT student.id, student.matricule, student.status, account.display_name AS name, student.created_at
      FROM unoa.student JOIN unoa.account ON account.id = student.account_id
      WHERE student.institution_id = $1 AND ($2::text IS NULL OR student.matricule ILIKE $2 OR account.display_name ILIKE $2)
      ORDER BY student.created_at DESC LIMIT 200`, [institutionId, query]),
    store.query<{ id: string; matricule: string; name: string | null; cohort: string; academic_year: string; kind: string; created_by: string }>(`
      SELECT registration.id, student.matricule, account.display_name AS name, cohort.label AS cohort, registration.academic_year, registration.kind, registration.created_by
      FROM unoa.registration JOIN unoa.student ON student.id = registration.student_id JOIN unoa.account ON account.id = student.account_id
      JOIN unoa.cohort ON cohort.id = registration.cohort_id
      WHERE student.institution_id = $1 AND registration.state = 'pending' ORDER BY registration.created_at`, [institutionId]),
  ]);
  return { institution: { id: institutionId, label: scope.rows[0]?.label ?? '' }, rights: granted, rule: rule.rows[0] ?? null,
    versions: versions.rows, cohorts: cohorts.rows, admitted: admitted.rows, students: students.rows, pending: pending.rows };
}

async function event(store: Queryable, studentId: string, kind: string, detail: string | null, actor: string) {
  await store.query('INSERT INTO unoa.student_event(student_id, kind, detail, actor_id) VALUES ($1, $2, $3, $4)', [studentId, kind, detail, actor]);
}

async function cohortOf(store: Queryable, cohortId: string) {
  const { rows } = await store.query<{ id: string; institution_id: string; academic_year: string; label: string; program_title: string }>(`
    SELECT cohort.id, cohort.institution_id, cohort.academic_year, cohort.label, version.title AS program_title
    FROM unoa.cohort JOIN unoa.program_version AS version ON version.id = cohort.version_id WHERE cohort.id = $1`, [cohortId]);
  ensure(rows[0], 404, 'Cohorte introuvable');
  return rows[0];
}

async function studentOf(store: Queryable, studentId: string) {
  const { rows } = await store.query<{ id: string; account_id: string; institution_id: string; matricule: string; status: string }>(
    'SELECT id, account_id, institution_id, matricule, status FROM unoa.student WHERE id = $1 FOR UPDATE', [studentId]);
  ensure(rows[0], 404, 'Dossier introuvable');
  return rows[0];
}

export async function sisAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.sis.' + action, async store => {
    if (action === 'rule') {
      const institutionId = uuid(input.institutionId);
      await require(store, actor, institutionId, 'manage');
      const pattern = boundedText(input.pattern, 60, 'Motif').toUpperCase().replace('{SEQ:', '{SEQ:');
      ensure(/^([A-Z0-9/._-]|\{AAAA\}|\{AA\}|\{SEQ:[3-9]\})+$/.test(pattern) && /\{SEQ:[3-9]\}/.test(pattern), 400,
        'Motif : lettres, chiffres, / . _ -, {AAAA}, {AA} et un {SEQ:n} (n de 3 à 9)');
      await store.query(`INSERT INTO unoa.matricule_rule(institution_id, pattern, changed_by) VALUES ($1, $2, $3)
        ON CONFLICT (institution_id) DO UPDATE SET pattern = EXCLUDED.pattern, changed_by = EXCLUDED.changed_by, changed_at = now()`,
        [institutionId, pattern, actor]);
      await audit(store, actor, institutionId, 'sis.rule_changed', correlation, null);
      return { institutionId };
    }
    if (action === 'cohorts') {
      const versionId = uuid(input.versionId);
      const { rows } = await store.query<{ institution_id: string; owner_scope_id: string }>(`
        SELECT program.institution_id, program.owner_scope_id FROM unoa.program_version AS version JOIN unoa.program ON program.id = version.program_id
        WHERE version.id = $1 AND version.state = 'published'`, [versionId]);
      ensure(rows[0], 422, 'Version publiée requise');
      await require(store, actor, rows[0].institution_id, 'manage');
      const startsOn = day(input.startsOn, 'Début'); const endsOn = day(input.endsOn, 'Fin');
      const capacity = optional(input.capacity, value => integer(value, 'Capacité', 1, 100000));
      const { rows: created } = await store.query<{ id: string }>(`
        INSERT INTO unoa.cohort(version_id, institution_id, owner_scope_id, code, label, academic_year, starts_on, ends_on, capacity, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
      `, [versionId, rows[0].institution_id, rows[0].owner_scope_id, businessCode(input.code, 'Code'),
        boundedText(input.label, 160, 'Intitulé'), academicYear(input.academicYear), startsOn, endsOn, capacity, actor]);
      await audit(store, actor, rows[0].institution_id, 'sis.cohort_created', correlation, created[0].id);
      return { id: created[0].id, institutionId: rows[0].institution_id };
    }
    if (action === 'groups' || action === 'close-cohort') {
      const cohort = await cohortOf(store, uuid(input.cohortId));
      await require(store, actor, cohort.institution_id, 'manage');
      if (action === 'groups') await store.query('INSERT INTO unoa.cohort_group(cohort_id, label) VALUES ($1, $2)', [cohort.id, boundedText(input.label, 120, 'Groupe')]);
      else await store.query("UPDATE unoa.cohort SET state = 'closed' WHERE id = $1", [cohort.id]);
      await audit(store, actor, cohort.institution_id, 'sis.' + action.replace('-', '_'), correlation, cohort.id);
      return { institutionId: cohort.institution_id };
    }
    if (action === 'enrol') {
      // Admission accepted → student record (matricule) → pending administrative registration.
      const cohort = await cohortOf(store, uuid(input.cohortId));
      await require(store, actor, cohort.institution_id, 'enrol');
      const applicationId = uuid(input.applicationId);
      const { rows: application } = await store.query<{ applicant_id: string; version_id: string; state: string }>(`
        SELECT application.applicant_id, round.version_id, application.state FROM unoa.application
        JOIN unoa.admission_round AS round ON round.id = application.round_id WHERE application.id = $1 FOR UPDATE OF application`, [applicationId]);
      ensure(application[0], 404, 'Candidature introuvable');
      ensure(application[0].state === 'accepted', 422, 'Seule une admission acceptée par le candidat ouvre l’inscription');
      const { rows: sameVersion } = await store.query('SELECT 1 FROM unoa.cohort WHERE id = $1 AND version_id = $2', [cohort.id, application[0].version_id]);
      ensure(sameVersion[0], 422, 'La cohorte doit relever de la formation admise');
      let { rows: [student] } = await store.query<{ id: string; matricule: string }>(
        'SELECT id, matricule FROM unoa.student WHERE account_id = $1 AND institution_id = $2', [application[0].applicant_id, cohort.institution_id]);
      if (!student) {
        const { rows } = await store.query<{ id: string; matricule: string }>(`
          INSERT INTO unoa.student(account_id, institution_id, matricule, application_id, created_by)
          VALUES ($1, $2, unoa.next_matricule($2), $3, $4) RETURNING id, matricule`, [application[0].applicant_id, cohort.institution_id, applicationId, actor]);
        student = rows[0];
        await event(store, student.id, 'created', 'Dossier ouvert après admission (matricule ' + student.matricule + ')', actor);
      }
      const { rows: registration } = await store.query<{ id: string }>(`
        INSERT INTO unoa.registration(student_id, cohort_id, group_id, academic_year, kind, created_by)
        VALUES ($1, $2, $3, $4, 'first', $5) RETURNING id`, [student.id, cohort.id, optional(input.groupId, uuid), cohort.academic_year, actor]);
      await event(store, student.id, 'registration_requested', cohort.label + ' · ' + cohort.academic_year, actor);
      await audit(store, actor, cohort.institution_id, 'sis.enrolled', correlation, student.id);
      return { id: student.id, registration: registration[0].id, matricule: student.matricule, institutionId: cohort.institution_id };
    }
    if (action === 'register') {
      // Renewal or change of programme for an existing student.
      const student = await studentOf(store, uuid(input.studentId));
      const cohort = await cohortOf(store, uuid(input.cohortId));
      ensure(cohort.institution_id === student.institution_id, 422, 'Cohorte d’un autre établissement');
      const kind = choice(input.kind, ['renewal', 'change'] as const, 'Nature');
      await require(store, actor, student.institution_id, kind === 'change' ? 'status' : 'enrol');
      if (kind === 'change') {
        const reason = boundedText(input.reason, 1000, 'Motif');
        await store.query(`UPDATE unoa.registration SET state = 'cancelled', decided_by = coalesce(decided_by, $2), decided_at = coalesce(decided_at, now())
          WHERE student_id = $1 AND academic_year = $3 AND state <> 'cancelled' AND created_by <> $2`, [student.id, actor, cohort.academic_year]);
        await event(store, student.id, 'program_changed', cohort.program_title + ' — ' + reason, actor);
      }
      const { rows } = await store.query<{ id: string }>(`
        INSERT INTO unoa.registration(student_id, cohort_id, academic_year, kind, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [student.id, cohort.id, cohort.academic_year, kind, actor]);
      await event(store, student.id, 'registration_requested', cohort.label + ' · ' + cohort.academic_year + (kind === 'renewal' ? ' (réinscription)' : ''), actor);
      await audit(store, actor, student.institution_id, 'sis.registered', correlation, rows[0].id);
      return { id: student.id, institutionId: student.institution_id };
    }
    if (action === 'validate' || action === 'cancel') {
      const registrationId = uuid(input.registrationId);
      const { rows } = await store.query<{ student_id: string; created_by: string; state: string; academic_year: string; cohort_id: string }>(
        'SELECT student_id, created_by, state, academic_year, cohort_id FROM unoa.registration WHERE id = $1 FOR UPDATE', [registrationId]);
      ensure(rows[0], 404, 'Inscription introuvable');
      const student = await studentOf(store, rows[0].student_id);
      await require(store, actor, student.institution_id, 'validate');
      ensure(rows[0].created_by !== actor, 403, 'La validation revient à une autre personne que l’auteur de l’inscription');
      ensure(action === 'cancel' ? rows[0].state !== 'cancelled' : rows[0].state === 'pending', 409, 'Inscription déjà traitée');
      const conditions = optional(input.conditions, text(1000, 'Conditions'));
      const reason = action === 'cancel' ? boundedText(input.reason, 1000, 'Motif') : null;
      await store.query(`UPDATE unoa.registration SET state = $2, decided_by = coalesce(decided_by, $3), decided_at = coalesce(decided_at, now()) WHERE id = $1`,
        [registrationId, action === 'validate' ? 'validated' : 'cancelled', actor]);
      if (conditions) await store.query('UPDATE unoa.registration SET conditions = $2 WHERE id = $1', [registrationId, conditions]);
      await event(store, student.id, action === 'validate' ? 'registration_validated' : 'registration_cancelled', reason ?? conditions, actor);
      if (action === 'validate') {
        const cohort = await cohortOf(store, rows[0].cohort_id);
        // Every unit of the programme is registered by default; options are adjusted afterwards.
        await store.query(`INSERT INTO unoa.course_registration(registration_id, unit_id)
          SELECT $1, unit.id FROM unoa.teaching_unit AS unit JOIN unoa.cohort ON cohort.version_id = unit.version_id
          WHERE cohort.id = $2 AND unit.option_group_id IS NULL ON CONFLICT DO NOTHING`, [registrationId, rows[0].cohort_id]);
        await dispatch(store, { event: 'sis.registration_validated', scopeId: student.institution_id, recipients: [student.account_id],
          values: { program: cohort.program_title, matricule: student.matricule, year: rows[0].academic_year }, link: '/etudiant', correlation });
      }
      await audit(store, actor, student.institution_id, 'sis.registration_' + (action === 'validate' ? 'validated' : 'cancelled'), correlation, registrationId);
      return { id: student.id, institutionId: student.institution_id };
    }
    if (action === 'units') {
      const registrationId = uuid(input.registrationId);
      const { rows } = await store.query<{ student_id: string; state: string }>('SELECT student_id, state FROM unoa.registration WHERE id = $1', [registrationId]);
      ensure(rows[0], 404, 'Inscription introuvable');
      const student = await studentOf(store, rows[0].student_id);
      await require(store, actor, student.institution_id, 'enrol');
      ensure(rows[0].state === 'validated', 409, 'L’inscription pédagogique suit la validation administrative');
      const unitId = uuid(input.unitId);
      const state = choice(input.state, ['registered', 'withdrawn'] as const, 'Choix');
      await store.query(`INSERT INTO unoa.course_registration(registration_id, unit_id, state) VALUES ($1, $2, $3)
        ON CONFLICT (registration_id, unit_id) DO UPDATE SET state = EXCLUDED.state, changed_at = now()`, [registrationId, unitId, state]);
      await event(store, student.id, 'units_changed', null, actor);
      return { id: student.id, institutionId: student.institution_id };
    }
    if (action in transitions) {
      const student = await studentOf(store, uuid(input.studentId));
      await require(store, actor, student.institution_id, 'status');
      const rule = transitions[action];
      ensure(rule.from.includes(student.status), 409, 'Changement de statut impossible depuis « ' + statusLabels[student.status] + ' »');
      const reason = boundedText(input.reason, 1000, 'Motif');
      if (action === 'graduate') {
        const { rows } = await store.query('SELECT 1 FROM unoa.registration WHERE student_id = $1 AND state = \'validated\' LIMIT 1', [student.id]);
        ensure(rows[0], 422, 'Aucune inscription validée');
      }
      await store.query('UPDATE unoa.student SET status = $2 WHERE id = $1', [student.id, rule.to]);
      await event(store, student.id, 'status_' + rule.to, reason, actor);
      await dispatch(store, { event: 'sis.status_changed', scopeId: student.institution_id, recipients: [student.account_id],
        values: { status: statusLabels[rule.to], reason }, link: '/etudiant', correlation });
      await audit(store, actor, student.institution_id, 'sis.status_' + rule.to, correlation, student.id);
      return { id: student.id, institutionId: student.institution_id };
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

export async function studentRecord(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows } = await store.query<{ id: string; account_id: string; institution_id: string; institution: string; matricule: string; status: string;
    created_at: Date; name: string | null; email: string | null }>(`
    SELECT student.id, student.account_id, student.institution_id, scope.label AS institution, student.matricule, student.status, student.created_at,
      account.display_name AS name, account.email
    FROM unoa.student JOIN unoa.scope ON scope.id = student.institution_id JOIN unoa.account ON account.id = student.account_id WHERE student.id = $1`, [uuid(id)]);
  ensure(rows[0], 404, 'Dossier introuvable');
  const student = rows[0];
  const own = student.account_id === actor;
  const granted = await rights(store, actor, student.institution_id);
  ensure(own || granted?.read, 403, 'Dossier inaccessible');
  const [registrations, units, events, cohorts] = await Promise.all([
    store.query<{ id: string; academic_year: string; kind: string; state: string; conditions: string | null; cohort: string; cohort_id: string;
      program_title: string; starts_on: string; ends_on: string; group_label: string | null; created_by: string }>(`
      SELECT registration.id, registration.academic_year, registration.kind, registration.state, registration.conditions, cohort.label AS cohort, cohort.id AS cohort_id,
        version.title AS program_title, cohort.starts_on::text, cohort.ends_on::text, cohort_group.label AS group_label, registration.created_by
      FROM unoa.registration JOIN unoa.cohort ON cohort.id = registration.cohort_id JOIN unoa.program_version AS version ON version.id = cohort.version_id
      LEFT JOIN unoa.cohort_group ON cohort_group.id = registration.group_id
      WHERE registration.student_id = $1 ORDER BY registration.academic_year DESC, registration.created_at DESC`, [student.id]),
    store.query<{ registration_id: string; unit_id: string; code: string; title: string; credits: string; period: string; optional: boolean; state: string | null }>(`
      SELECT registration.id AS registration_id, unit.id AS unit_id, unit.code, unit.title, unit.credits, period.label AS period,
        unit.option_group_id IS NOT NULL AS optional, course.state
      FROM unoa.registration JOIN unoa.cohort ON cohort.id = registration.cohort_id
      JOIN unoa.teaching_unit AS unit ON unit.version_id = cohort.version_id JOIN unoa.program_period AS period ON period.id = unit.period_id
      LEFT JOIN unoa.course_registration AS course ON course.registration_id = registration.id AND course.unit_id = unit.id
      WHERE registration.student_id = $1 AND registration.state = 'validated' ORDER BY period.ordinal, unit.code`, [student.id]),
    store.query<{ kind: string; detail: string | null; occurred_at: Date; actor: string | null }>(`
      SELECT event.kind, event.detail, event.occurred_at, account.display_name AS actor FROM unoa.student_event AS event
      LEFT JOIN unoa.account ON account.id = event.actor_id WHERE event.student_id = $1 ORDER BY event.occurred_at DESC`, [student.id]),
    granted?.enrol || granted?.status ? store.query<{ id: string; label: string; academic_year: string }>(
      "SELECT id, label, academic_year FROM unoa.cohort WHERE institution_id = $1 AND state = 'open' ORDER BY academic_year DESC, label", [student.institution_id]) : { rows: [] },
  ]);
  const registered = units.rows.filter(unit => unit.state === 'registered' || unit.state === 'validated');
  const credits = {
    acquired: registered.filter(unit => unit.state === 'validated').reduce((sum, unit) => sum + Number(unit.credits), 0),
    pending: registered.filter(unit => unit.state === 'registered').reduce((sum, unit) => sum + Number(unit.credits), 0),
    required: units.rows.filter(unit => !unit.optional).reduce((sum, unit) => sum + Number(unit.credits), 0),
  };
  return { student, own, rights: granted, registrations: registrations.rows, units: units.rows, events: events.rows, cohorts: cohorts.rows, credits, statusLabels };
}

export async function myStudentRecords(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string }>('SELECT id FROM unoa.student WHERE account_id = $1 ORDER BY created_at', [actor]);
  return Promise.all(rows.map(row => studentRecord(settings, actor, row.id)));
}

// SIS-014: the record as a portable file, for the student or authorised staff.
export async function studentExport(settings: IamSettings, actor: string, id: string) {
  const record = await studentRecord(settings, actor, id);
  return {
    exportedAt: new Date().toISOString(), institution: record.student.institution, matricule: record.student.matricule,
    name: record.student.name, status: record.student.status, credits: record.credits,
    registrations: record.registrations.map(({ created_by: _author, ...item }) => item), units: record.units, history: record.events,
  };
}
