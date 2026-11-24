import 'server-only';
import { createHash } from 'node:crypto';
import { matchesFormat } from '@unoa/domain/forms';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { amount, boundedText, choice, day, ensure, optional, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Teachers (module TEA). Staff rights on the target scope; a candidate or a
// teacher acts on their own profile, applications and contracts only.

type Right = 'read' | 'manage' | 'verify' | 'review' | 'decide';
export const functions = ['teacher', 'author', 'tutor', 'grader', 'jury', 'supervisor'] as const;
export const functionLabels: Record<string, string> = {
  teacher: 'Enseignant', author: 'Auteur de cours', tutor: 'Tuteur', grader: 'Correcteur', jury: 'Membre de jury', supervisor: 'Directeur de mémoire',
};
const documentKinds = ['diploma', 'cv', 'reference', 'publication'] as const;

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'tea.read', $2) AS read, unoa.has_scope_permission($1, 'tea.manage', $2) AS manage,
      unoa.has_scope_permission($1, 'tea.verify', $2) AS verify, unoa.has_scope_permission($1, 'tea.review', $2) AS review,
      unoa.has_scope_permission($1, 'tea.decide', $2) AS decide`, [actor, scopeId]);
  return rows[0];
}
async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux responsables du recrutement');
  return granted;
}

// ------------------------------------------------------------ candidate side

export async function teacherSpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [profile, openings, applications, contracts, assignments] = await Promise.all([
    store.query('SELECT * FROM unoa.teacher_profile WHERE account_id = $1', [actor]),
    store.query<{ id: string; title: string; discipline: string; level: string; region: string | null; description: string; closes_at: Date; scope_label: string; scope_id: string }>(`
      SELECT opening.id, opening.title, opening.discipline, opening.level, opening.region, opening.description, opening.closes_at, scope.label AS scope_label, opening.scope_id
      FROM unoa.job_opening AS opening JOIN unoa.scope ON scope.id = opening.scope_id
      WHERE opening.state = 'open' AND opening.closes_at > now() ORDER BY opening.closes_at LIMIT 100`),
    store.query<{ id: string; course_title: string; state: string; decision: string | null; decision_reason: string | null; opening_title: string | null; scope_label: string; submitted_at: Date | null }>(`
      SELECT application.id, application.course_title, application.state, application.decision, application.decision_reason, opening.title AS opening_title,
        scope.label AS scope_label, application.submitted_at
      FROM unoa.teacher_application AS application JOIN unoa.scope ON scope.id = application.scope_id
      LEFT JOIN unoa.job_opening AS opening ON opening.id = application.opening_id WHERE application.applicant_id = $1 ORDER BY application.created_at DESC`, [actor]),
    store.query<{ id: string; function: string; starts_on: string; ends_on: string; hours: string; hourly_rate: string; currency: string; state: string;
      teacher_signed_at: Date | null; institution_signed_at: Date | null; terms: string | null; scope_label: string }>(`
      SELECT contract.id, contract.function, contract.starts_on::text, contract.ends_on::text, contract.hours, contract.hourly_rate, contract.currency, contract.state,
        contract.teacher_signed_at, contract.institution_signed_at, contract.terms, scope.label AS scope_label
      FROM unoa.teacher_contract AS contract JOIN unoa.scope ON scope.id = contract.scope_id WHERE contract.account_id = $1 ORDER BY contract.starts_on DESC`, [actor]),
    store.query<{ id: string; function: string; hours: string; state: string; course: string; offering: string; obligations: { label: string; due_on: string; done_at: string | null; id: string }[] }>(`
      SELECT assignment.id, assignment.function, assignment.hours, assignment.state, version.title AS course, offering.label AS offering,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label, 'due_on', due_on, 'done_at', done_at) ORDER BY due_on)
          FROM unoa.teaching_obligation WHERE assignment_id = assignment.id), '[]') AS obligations
      FROM unoa.teaching_assignment AS assignment JOIN unoa.teacher_contract AS contract ON contract.id = assignment.contract_id
      JOIN unoa.course_offering AS offering ON offering.id = assignment.offering_id JOIN unoa.course_version AS version ON version.id = offering.course_version_id
      WHERE contract.account_id = $1 ORDER BY assignment.created_at DESC`, [actor]),
  ]);
  return { profile: profile.rows[0] ?? null, openings: openings.rows, applications: applications.rows, contracts: contracts.rows, assignments: assignments.rows };
}

async function ownApplication(store: Queryable, actor: string, id: string) {
  const { rows } = await store.query<{ id: string; applicant_id: string; state: string; scope_id: string; syllabus: string | null; pedagogy: string | null }>(
    'SELECT id, applicant_id, state, scope_id, syllabus, pedagogy FROM unoa.teacher_application WHERE id = $1 FOR UPDATE', [uuid(id)]);
  ensure(rows[0], 404, 'Candidature introuvable');
  ensure(rows[0].applicant_id === actor, 403, 'Seul le candidat agit sur sa candidature');
  return rows[0];
}

export async function candidateAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.tea.candidate.' + actor, async store => {
    if (action === 'profile') {
      await store.query(`INSERT INTO unoa.teacher_profile(account_id, title, discipline, biography, publications, availability) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (account_id) DO UPDATE SET title = EXCLUDED.title, discipline = EXCLUDED.discipline, biography = EXCLUDED.biography,
          publications = EXCLUDED.publications, availability = EXCLUDED.availability, updated_at = now()`,
        [actor, optional(input.title, text(120, 'Titre')), boundedText(input.discipline, 200, 'Discipline'), optional(input.biography, text(4000, 'Parcours')),
          optional(input.publications, text(8000, 'Publications')), optional(input.availability, text(1000, 'Disponibilités'))]);
      return { done: true };
    }
    if (action === 'apply') {
      const { rows: profile } = await store.query('SELECT 1 FROM unoa.teacher_profile WHERE account_id = $1', [actor]);
      ensure(profile[0], 422, 'Complétez d’abord votre profil enseignant');
      let scopeId: string; let openingId: string | null = null;
      if (input.openingId) {
        openingId = uuid(input.openingId);
        const { rows } = await store.query<{ scope_id: string }>("SELECT scope_id FROM unoa.job_opening WHERE id = $1 AND state = 'open' AND closes_at > now()", [openingId]);
        ensure(rows[0], 422, 'Appel clos ou introuvable');
        scopeId = rows[0].scope_id;
      } else {
        scopeId = uuid(input.scopeId);
        const { rows } = await store.query("SELECT 1 FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE scope.id = $1 AND kind.nature IN ('institution', 'academic_unit')", [scopeId]);
        ensure(rows[0], 422, 'Candidature spontanée auprès d’un établissement ou d’une composante');
      }
      const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.teacher_application(opening_id, scope_id, applicant_id, course_title) VALUES ($1, $2, $3, $4) RETURNING id`,
        [openingId, scopeId, actor, boundedText(input.courseTitle, 200, 'Cours proposé')]).catch(error => {
        if (error?.code === '23505') throw new Problem(409, 'Vous avez déjà candidaté à cet appel');
        throw error;
      });
      await audit(store, actor, scopeId, 'tea.application_started', correlation, rows[0].id);
      return { applicationId: rows[0].id };
    }
    const application = await ownApplication(store, actor, String(input.applicationId));
    if (action === 'proposal') {
      ensure(application.state === 'draft', 409, 'Candidature déjà déposée');
      await store.query('UPDATE unoa.teacher_application SET course_title = $2, syllabus = $3, pedagogy = $4 WHERE id = $1', [application.id,
        boundedText(input.courseTitle, 200, 'Cours proposé'), optional(input.syllabus, text(12000, 'Syllabus')), optional(input.pedagogy, text(6000, 'Proposition pédagogique'))]);
    } else if (action === 'submit') {
      ensure(application.state === 'draft', 409, 'Candidature déjà déposée');
      ensure(application.syllabus && application.pedagogy, 422, 'Le syllabus et la proposition pédagogique sont exigés');
      const { rows } = await store.query("SELECT kind FROM unoa.teacher_document WHERE application_id = $1 AND state <> 'rejected'", [application.id]);
      const kinds = new Set(rows.map(row => row.kind));
      ensure(kinds.has('diploma') && kinds.has('cv'), 422, 'Diplôme et CV sont exigés');
      await store.query("UPDATE unoa.teacher_application SET state = 'submitted', submitted_at = now() WHERE id = $1", [application.id]);
    } else if (action === 'withdraw') {
      ensure(['draft', 'submitted', 'review'].includes(application.state), 409, 'Candidature déjà décidée');
      await store.query("UPDATE unoa.teacher_application SET state = 'withdrawn' WHERE id = $1", [application.id]);
    } else {
      throw new Problem(404, 'Opération inconnue');
    }
    await audit(store, actor, application.scope_id, 'tea.application_' + action, correlation, application.id);
    return { applicationId: application.id };
  });
}

export async function uploadTeacherDocument(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const file = input.file;
  ensure(file instanceof File, 400, 'Fichier requis');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = choice(input.kind, documentKinds, 'Pièce');
  const extension = (file.name.split('.').pop() ?? '').toLowerCase().replace('jpeg', 'jpg');
  ensure(['pdf', 'png', 'jpg'].includes(extension) && matchesFormat(bytes, extension), 400, 'Formats acceptés : PDF, PNG, JPG');
  ensure(bytes.byteLength > 0 && bytes.byteLength <= 5 * 1024 * 1024, 413, 'Fichier de 5 Mo au plus');
  return transaction(settings, 'unoa.tea.document', async store => {
    const application = await ownApplication(store, actor, String(input.applicationId));
    ensure(application.state === 'draft', 409, 'Pièces déposées avant le dépôt du dossier');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.teacher_document(application_id, kind, filename, format, size_bytes, sha256, content)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [application.id, kind, file.name.slice(0, 200), extension, bytes.byteLength,
      createHash('sha256').update(bytes).digest('hex'), Buffer.from(bytes)]);
    await audit(store, actor, application.scope_id, 'tea.document_deposited', correlation, rows[0].id);
    return { applicationId: application.id };
  });
}

export async function teacherDocument(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows } = await store.query<{ filename: string; format: string; content: Buffer; applicant_id: string; scope_id: string }>(`
    SELECT document.filename, document.format, document.content, application.applicant_id, application.scope_id FROM unoa.teacher_document AS document
    JOIN unoa.teacher_application AS application ON application.id = document.application_id WHERE document.id = $1`, [uuid(id)]);
  ensure(rows[0], 404, 'Pièce introuvable');
  ensure(rows[0].applicant_id === actor || (await rights(store, actor, rows[0].scope_id))?.read, 403, 'Pièce inaccessible');
  return rows[0];
}

export async function contractSign(settings: IamSettings, actor: string, id: string, correlation: string) {
  return transaction(settings, 'unoa.tea.contract.' + id, async store => {
    const { rows } = await store.query<{ account_id: string; state: string; teacher_signed_at: Date | null; institution_signed_at: Date | null; scope_id: string }>(
      'SELECT account_id, state, teacher_signed_at, institution_signed_at, scope_id FROM unoa.teacher_contract WHERE id = $1 FOR UPDATE', [uuid(id)]);
    ensure(rows[0], 404, 'Contrat introuvable');
    ensure(rows[0].account_id === actor, 403, 'Signature réservée au titulaire');
    ensure(rows[0].state === 'draft' && !rows[0].teacher_signed_at, 409, 'Contrat déjà signé');
    await store.query(`UPDATE unoa.teacher_contract SET teacher_signed_at = now(), state = CASE WHEN institution_signed_at IS NOT NULL THEN 'signed' ELSE state END WHERE id = $1`, [id]);
    await audit(store, actor, rows[0].scope_id, 'tea.contract_signed_teacher', correlation, id);
    return { contractId: id };
  });
}

// ---------------------------------------------------------------- staff side

export async function teaContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`
    SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('territory', 'institution', 'academic_unit') AND unoa.has_scope_permission($1, 'tea.read', scope.id) ORDER BY kind.nature, scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function teaOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const [label, openings, applications, contracts, offerings] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; title: string; discipline: string; level: string; closes_at: Date; state: string; applications: number }>(`
      SELECT opening.id, opening.title, opening.discipline, opening.level, opening.closes_at, opening.state,
        (SELECT count(*)::int FROM unoa.teacher_application WHERE opening_id = opening.id AND state <> 'draft') AS applications
      FROM unoa.job_opening AS opening WHERE unoa.scope_within(opening.scope_id, $1) ORDER BY opening.created_at DESC LIMIT 100`, [scopeId]),
    store.query<{ id: string; name: string | null; course_title: string; state: string; decision: string | null; opening_title: string | null; submitted_at: Date | null }>(`
      SELECT application.id, account.display_name AS name, application.course_title, application.state, application.decision, opening.title AS opening_title, application.submitted_at
      FROM unoa.teacher_application AS application JOIN unoa.account ON account.id = application.applicant_id
      LEFT JOIN unoa.job_opening AS opening ON opening.id = application.opening_id
      WHERE unoa.scope_within(application.scope_id, $1) AND application.state NOT IN ('draft') ORDER BY application.submitted_at DESC NULLS LAST LIMIT 200`, [scopeId]),
    store.query<{ id: string; name: string | null; function: string; starts_on: string; ends_on: string; hours: string; hourly_rate: string; currency: string; state: string;
      teacher_signed_at: Date | null; institution_signed_at: Date | null; assigned_hours: string }>(`
      SELECT contract.id, account.display_name AS name, contract.function, contract.starts_on::text, contract.ends_on::text, contract.hours, contract.hourly_rate,
        contract.currency, contract.state, contract.teacher_signed_at, contract.institution_signed_at,
        coalesce((SELECT sum(hours) FROM unoa.teaching_assignment WHERE contract_id = contract.id AND state = 'active'), 0) AS assigned_hours
      FROM unoa.teacher_contract AS contract JOIN unoa.account ON account.id = contract.account_id
      WHERE unoa.scope_within(contract.scope_id, $1) ORDER BY contract.created_at DESC LIMIT 200`, [scopeId]),
    store.query<{ id: string; label: string; title: string }>(`
      SELECT offering.id, offering.label, version.title FROM unoa.course_offering AS offering JOIN unoa.course_version AS version ON version.id = offering.course_version_id
      WHERE unoa.scope_within(offering.owner_scope_id, $1) AND offering.state = 'open' ORDER BY version.title LIMIT 200`, [scopeId]),
  ]);
  return { scope: { id: scopeId, label: label.rows[0]?.label ?? '' }, rights: granted, openings: openings.rows, applications: applications.rows,
    contracts: contracts.rows, offerings: offerings.rows };
}

export async function teacherApplicationDetails(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows } = await store.query<{ id: string; scope_id: string; applicant_id: string; course_title: string; syllabus: string | null; pedagogy: string | null;
    state: string; decision: string | null; decision_reason: string | null; name: string | null; email: string | null; opening_title: string | null }>(`
    SELECT application.*, account.display_name AS name, account.email, opening.title AS opening_title FROM unoa.teacher_application AS application
    JOIN unoa.account ON account.id = application.applicant_id LEFT JOIN unoa.job_opening AS opening ON opening.id = application.opening_id
    WHERE application.id = $1`, [uuid(id)]);
  ensure(rows[0], 404, 'Candidature introuvable');
  const own = rows[0].applicant_id === actor;
  const granted = await rights(store, actor, rows[0].scope_id);
  ensure(own || granted?.read, 403, 'Candidature inaccessible');
  const [profile, documents, reviews] = await Promise.all([
    store.query('SELECT * FROM unoa.teacher_profile WHERE account_id = $1', [rows[0].applicant_id]),
    store.query<{ id: string; kind: string; filename: string; state: string; note: string | null; sha256: string }>(
      'SELECT id, kind, filename, state, note, sha256 FROM unoa.teacher_document WHERE application_id = $1 ORDER BY uploaded_at', [rows[0].id]),
    own ? Promise.resolve({ rows: [] as { kind: string; recommendation: string; note: string; reviewer: string | null; scheduled_at: Date | null; created_at: Date }[] })
      : store.query<{ kind: string; recommendation: string; note: string; reviewer: string | null; scheduled_at: Date | null; created_at: Date }>(`
      SELECT review.kind, review.recommendation, review.note, account.display_name AS reviewer, review.scheduled_at, review.created_at FROM unoa.teacher_review AS review
      JOIN unoa.account ON account.id = review.reviewer_id WHERE review.application_id = $1 ORDER BY review.created_at`, [rows[0].id]),
  ]);
  return { application: rows[0], own, rights: granted, profile: profile.rows[0] ?? null, documents: documents.rows, reviews: reviews.rows };
}

export async function staffTeaAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.tea.staff.' + action, async store => {
    if (action === 'openings') {
      const scopeId = uuid(input.scopeId);
      await require(store, actor, scopeId, 'manage');
      const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.job_opening(scope_id, title, discipline, level, region, description, closes_at, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [scopeId, boundedText(input.title, 200, 'Intitulé'), boundedText(input.discipline, 200, 'Discipline'),
        boundedText(input.level, 120, 'Niveau'), optional(input.region, text(120, 'Région')), boundedText(input.description, 6000, 'Description'), utcTime(input.closesAt), actor]);
      await audit(store, actor, scopeId, 'tea.opening_published', correlation, rows[0].id);
      return { scopeId };
    }
    if (action === 'close-opening') {
      const { rows } = await store.query<{ scope_id: string }>('SELECT scope_id FROM unoa.job_opening WHERE id = $1', [uuid(input.openingId)]);
      ensure(rows[0], 404, 'Appel introuvable');
      await require(store, actor, rows[0].scope_id, 'manage');
      await store.query("UPDATE unoa.job_opening SET state = 'closed' WHERE id = $1", [input.openingId]);
      return { scopeId: rows[0].scope_id };
    }
    if (['verify', 'review', 'decide'].includes(action)) {
      const { rows } = await store.query<{ id: string; scope_id: string; applicant_id: string; state: string; course_title: string }>(
        'SELECT id, scope_id, applicant_id, state, course_title FROM unoa.teacher_application WHERE id = $1 FOR UPDATE', [uuid(input.applicationId)]);
      ensure(rows[0], 404, 'Candidature introuvable');
      const application = rows[0];
      ensure(application.applicant_id !== actor, 403, 'Un candidat n’instruit pas sa propre candidature');
      const result = { applicationId: application.id, scopeId: application.scope_id };
      if (action === 'verify') {
        await require(store, actor, application.scope_id, 'verify');
        const state = choice(input.state, ['verified', 'rejected', 'falsified'] as const, 'Contrôle');
        const note = optional(input.note, text(500, 'Observation'));
        ensure(state === 'verified' || note, 400, 'Motiver le rejet');
        const updated = await store.query('UPDATE unoa.teacher_document SET state = $3, note = $4, checked_by = $5 WHERE id = $1 AND application_id = $2',
          [uuid(input.documentId), application.id, state, note, actor]);
        ensure(updated.rowCount === 1, 404, 'Pièce introuvable');
        // A falsified diploma stops the application at once.
        if (state === 'falsified' && ['submitted', 'review'].includes(application.state)) {
          await store.query(`UPDATE unoa.teacher_application SET state = 'decided', decision = 'rejected', decided_by = $2, decision_reason = 'Pièce falsifiée : ' || $3 WHERE id = $1`,
            [application.id, actor, note]);
        }
      } else if (action === 'review') {
        await require(store, actor, application.scope_id, 'review');
        ensure(['submitted', 'review'].includes(application.state), 409, 'Candidature hors instruction');
        await store.query(`INSERT INTO unoa.teacher_review(application_id, kind, reviewer_id, recommendation, note, scheduled_at) VALUES ($1, $2, $3, $4, $5, $6)`,
          [application.id, choice(input.kind, ['scientific', 'pedagogical', 'interview'] as const, 'Expertise'), actor,
            choice(input.recommendation, ['favourable', 'reserved', 'unfavourable'] as const, 'Avis'), boundedText(input.note, 4000, 'Avis motivé'),
            optional(input.scheduledAt, utcTime)]).catch(error => {
          if (error?.code === '23505') throw new Problem(409, 'Avis déjà rendu');
          throw error;
        });
        if (application.state === 'submitted') await store.query("UPDATE unoa.teacher_application SET state = 'review' WHERE id = $1", [application.id]);
      } else {
        await require(store, actor, application.scope_id, 'decide');
        ensure(application.state === 'review', 409, 'La décision suit l’instruction');
        const { rows: reviews } = await store.query<{ kind: string; reviewer_id: string }>('SELECT DISTINCT kind, reviewer_id FROM unoa.teacher_review WHERE application_id = $1', [application.id]);
        ensure(reviews.some(item => item.kind === 'scientific') && reviews.some(item => item.kind === 'pedagogical'), 422, 'Expertises scientifique et pédagogique requises');
        ensure(!reviews.some(item => item.reviewer_id === actor), 403, 'La décision collégiale revient à une autre personne que les experts');
        const { rows: documents } = await store.query("SELECT 1 FROM unoa.teacher_document WHERE application_id = $1 AND kind = 'diploma' AND state = 'verified'", [application.id]);
        const decision = choice(input.decision, ['accepted', 'rejected'] as const, 'Décision');
        ensure(decision === 'rejected' || documents[0], 422, 'Diplôme non vérifié par un contrôleur');
        await store.query(`UPDATE unoa.teacher_application SET state = 'decided', decision = $2, decision_reason = $3, decided_by = $4 WHERE id = $1`,
          [application.id, decision, boundedText(input.reason, 2000, 'Motif'), actor]);
        await dispatch(store, { event: 'tea.application_decided', scopeId: application.scope_id, recipients: [application.applicant_id],
          values: { title: application.course_title }, link: '/enseignement', correlation });
      }
      await audit(store, actor, application.scope_id, 'tea.' + action, correlation, application.id);
      return result;
    }
    if (action === 'contracts') {
      const { rows } = await store.query<{ applicant_id: string; scope_id: string; decision: string | null }>(
        'SELECT applicant_id, scope_id, decision FROM unoa.teacher_application WHERE id = $1', [uuid(input.applicationId)]);
      ensure(rows[0]?.decision === 'accepted', 422, 'Contrat après un recrutement accepté');
      await require(store, actor, rows[0].scope_id, 'manage');
      const fn = choice(input.function ?? 'teacher', functions, 'Fonction');
      const { rows: created } = await store.query<{ id: string }>(`INSERT INTO unoa.teacher_contract(account_id, scope_id, application_id, function, starts_on, ends_on,
        hours, hourly_rate, currency, terms, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [rows[0].applicant_id, rows[0].scope_id, input.applicationId, fn, day(input.startsOn, 'Début'), day(input.endsOn, 'Fin'), amount(input.hours, 'Heures', true),
          amount(input.hourlyRate, 'Taux horaire'), boundedText(input.currency ?? 'XOF', 3, 'Monnaie').toUpperCase(), optional(input.terms, text(6000, 'Clauses')), actor]);
      const { rows: scope } = await store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [rows[0].scope_id]);
      await dispatch(store, { event: 'tea.contract_ready', scopeId: rows[0].scope_id, recipients: [rows[0].applicant_id],
        values: { scope: scope[0].label, function: functionLabels[fn] }, link: '/enseignement', correlation });
      await audit(store, actor, rows[0].scope_id, 'tea.contract_drafted', correlation, created[0].id);
      return { scopeId: rows[0].scope_id };
    }
    // ----- contract and assignment acts
    const contractId = uuid(input.contractId);
    const { rows: contracts } = await store.query<{ id: string; account_id: string; scope_id: string; state: string; teacher_signed_at: Date | null;
      institution_signed_at: Date | null; function: string; starts_on: string; ends_on: string; hours: string; hourly_rate: string; currency: string; terms: string | null }>(
      'SELECT *, starts_on::text, ends_on::text FROM unoa.teacher_contract WHERE id = $1 FOR UPDATE', [contractId]);
    ensure(contracts[0], 404, 'Contrat introuvable');
    const contract = contracts[0];
    const result = { scopeId: contract.scope_id };
    if (action === 'sign') {
      await require(store, actor, contract.scope_id, 'decide');
      ensure(contract.account_id !== actor, 403, 'Le titulaire ne signe pas pour l’établissement');
      ensure(contract.state === 'draft' && !contract.institution_signed_at, 409, 'Contrat déjà signé par l’établissement');
      await store.query(`UPDATE unoa.teacher_contract SET institution_signed_by = $2, institution_signed_at = now(),
        state = CASE WHEN teacher_signed_at IS NOT NULL THEN 'signed' ELSE state END WHERE id = $1`, [contractId, actor]);
    } else if (action === 'suspend' || action === 'resume' || action === 'end') {
      await require(store, actor, contract.scope_id, 'manage');
      const allowed = { suspend: ['signed'], resume: ['suspended'], end: ['draft', 'signed', 'suspended'] }[action];
      ensure(allowed.includes(contract.state), 409, 'Transition impossible');
      const reason = boundedText(input.reason, 1000, 'Motif');
      await store.query(`UPDATE unoa.teacher_contract SET state = $2, ended_at = CASE WHEN $2 = 'ended' THEN now() ELSE ended_at END,
        end_reason = CASE WHEN $2 = 'ended' THEN $3 ELSE end_reason END WHERE id = $1`, [contractId, { suspend: 'suspended', resume: 'signed', end: 'ended' }[action], reason]);
      if (action !== 'resume') {
        // Suspension and end remove the teaching access at once (TEA-015).
        await store.query(`UPDATE unoa.offering_member AS member SET removed_at = now(), removed_by = $2 FROM unoa.teaching_assignment AS assignment
          WHERE assignment.contract_id = $1 AND assignment.state = 'active' AND member.offering_id = assignment.offering_id
            AND member.account_id = $3 AND member.removed_at IS NULL AND member.role <> 'learner'`, [contractId, actor, contract.account_id]);
        if (action === 'end') await store.query("UPDATE unoa.teaching_assignment SET state = 'ended', ended_at = now() WHERE contract_id = $1 AND state = 'active'", [contractId]);
      }
    } else if (action === 'renew') {
      await require(store, actor, contract.scope_id, 'manage');
      ensure(['signed', 'ended'].includes(contract.state), 409, 'Renouvellement d’un contrat signé ou terminé');
      await store.query(`INSERT INTO unoa.teacher_contract(account_id, scope_id, application_id, function, starts_on, ends_on, hours, hourly_rate, currency, terms, renewed_from, created_by)
        SELECT account_id, scope_id, application_id, function, $2, $3, hours, hourly_rate, currency, terms, id, $4 FROM unoa.teacher_contract WHERE id = $1`,
        [contractId, day(input.startsOn, 'Début'), day(input.endsOn, 'Fin'), actor]);
    } else if (action === 'assign') {
      await require(store, actor, contract.scope_id, 'manage');
      ensure(contract.state === 'signed', 422, 'Affectation après signature du contrat par les deux parties');
      ensure(contract.ends_on >= new Date().toISOString().slice(0, 10), 422, 'Contrat expiré');
      const offeringId = uuid(input.offeringId);
      const { rows: offering } = await store.query<{ title: string }>(`SELECT version.title FROM unoa.course_offering AS offering JOIN unoa.course_version AS version
        ON version.id = offering.course_version_id WHERE offering.id = $1 AND offering.state = 'open' AND unoa.scope_within(offering.owner_scope_id, $2)`, [offeringId, contract.scope_id]);
      ensure(offering[0], 422, 'Offre de cours ouverte du même périmètre requise');
      const fn = choice(input.function ?? contract.function, functions, 'Fonction');
      const hours = amount(input.hours, 'Heures', true);
      const { rows: used } = await store.query<{ total: string }>("SELECT coalesce(sum(hours), 0) AS total FROM unoa.teaching_assignment WHERE contract_id = $1 AND state = 'active'", [contractId]);
      ensure(Number(used[0].total) + Number(hours) <= Number(contract.hours), 422, 'Heures au-delà du volume du contrat');
      await store.query(`INSERT INTO unoa.teaching_assignment(contract_id, offering_id, function, hours, grading_days, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
        [contractId, offeringId, fn, hours, optional(input.gradingDays, value => Number(value)), actor]).catch(error => {
        if (error?.code === '23505') throw new Problem(409, 'Affectation déjà existante');
        throw error;
      });
      const role = fn === 'teacher' || fn === 'author' ? 'teacher' : 'tutor';
      await store.query(`INSERT INTO unoa.offering_member(offering_id, account_id, role, added_by)
        SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM unoa.offering_member WHERE offering_id = $1 AND account_id = $2 AND removed_at IS NULL)`,
        [offeringId, contract.account_id, role, actor]);
      await dispatch(store, { event: 'tea.assigned', scopeId: contract.scope_id, recipients: [contract.account_id],
        values: { course: offering[0].title, function: functionLabels[fn] }, link: '/apprendre', correlation });
    } else if (action === 'obligations') {
      await require(store, actor, contract.scope_id, 'manage');
      const updated = await store.query(`INSERT INTO unoa.teaching_obligation(assignment_id, label, due_on, created_by)
        SELECT id, $3, $4, $5 FROM unoa.teaching_assignment WHERE id = $1 AND contract_id = $2`, [uuid(input.assignmentId), contractId,
        boundedText(input.label, 200, 'Obligation'), day(input.dueOn, 'Échéance'), actor]);
      ensure(updated.rowCount === 1, 404, 'Affectation introuvable');
    } else {
      throw new Problem(404, 'Opération inconnue');
    }
    await audit(store, actor, contract.scope_id, 'tea.contract_' + action, correlation, contractId);
    return result;
  });
}

export async function obligationDone(settings: IamSettings, actor: string, id: string, correlation: string) {
  return transaction(settings, 'unoa.tea.obligation', async store => {
    const updated = await store.query(`UPDATE unoa.teaching_obligation AS obligation SET done_at = now() FROM unoa.teaching_assignment AS assignment, unoa.teacher_contract AS contract
      WHERE obligation.id = $1 AND assignment.id = obligation.assignment_id AND contract.id = assignment.contract_id AND contract.account_id = $2 AND obligation.done_at IS NULL`,
      [uuid(id), actor]);
    ensure(updated.rowCount === 1, 404, 'Obligation introuvable');
    await audit(store, actor, null, 'tea.obligation_done', correlation, id);
    return { done: true };
  });
}

// TEA-013: remuneration statement (hours × rate per signed contract), CSV.
export async function remunerationCsv(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  await require(store, actor, scopeId, 'manage');
  const { rows } = await store.query<{ name: string | null; function: string; starts_on: string; ends_on: string; hours: string; hourly_rate: string; currency: string; state: string }>(`
    SELECT account.display_name AS name, contract.function, contract.starts_on::text, contract.ends_on::text, contract.hours, contract.hourly_rate, contract.currency, contract.state
    FROM unoa.teacher_contract AS contract JOIN unoa.account ON account.id = contract.account_id
    WHERE unoa.scope_within(contract.scope_id, $1) AND contract.state IN ('signed', 'suspended', 'ended') ORDER BY account.display_name`, [scopeId]);
  const cell = (value: string) => /[",;\n]/.test(value) || /^[=+\-@]/.test(value) ? `"${value.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : value;
  return ['Nom;Fonction;Début;Fin;Heures;Taux horaire;Monnaie;Montant;État',
    ...rows.map(row => [row.name ?? '', functionLabels[row.function], row.starts_on, row.ends_on, row.hours, row.hourly_rate, row.currency,
      (Number(row.hours) * Number(row.hourly_rate)).toFixed(2), row.state].map(cell).join(';'))].join('\n');
}
