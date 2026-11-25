import 'server-only';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, integer, language, list, numeric, optional, Problem, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';
import { seal, templateFor, typeOf } from '@/lib/credentials/store';
import { money } from '@/lib/finance/store';

// Short courses (module SHORT). Staff rights on the course's scope; trainers
// validate progress with evidence; any signed-in person may enrol in an open
// public session; client sessions are reserved to the client's employees.

type Right = 'read' | 'manage' | 'approve' | 'train' | 'clients' | 'rpl';
export const modalityLabels: Record<string, string> = { online: 'En ligne', onsite: 'Sur site', hybrid: 'Hybride' };
export const enrollmentStates: Record<string, string> = { enrolled: 'En cours', completed: 'Réussie', not_passed: 'Non réussie', withdrawn: 'Retirée' };
export const rplStates: Record<string, string> = { submitted: 'Déposée', in_review: 'En examen', accepted: 'Acquis reconnus', partially_accepted: 'Acquis reconnus en partie', rejected: 'Non reconnus' };

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`SELECT unoa.has_scope_permission($1, 'short.read', $2) AS read, unoa.has_scope_permission($1, 'short.manage', $2) AS manage,
    unoa.has_scope_permission($1, 'short.approve', $2) AS approve, unoa.has_scope_permission($1, 'short.train', $2) AS train,
    unoa.has_scope_permission($1, 'short.clients', $2) AS clients, unoa.has_scope_permission($1, 'short.rpl', $2) AS rpl`, [actor, scopeId]);
  return rows[0];
}
async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux responsables des formations courtes');
  return granted;
}
// Competencies: a list (JSON) or a comma / line separated text; spaces stay inside a competency.
function competencies(input: unknown) {
  if (input === undefined || input === null || input === '') return [];
  const values = Array.isArray(input) ? input : String(input).split(/[,\n;]+/).map(item => item.trim()).filter(Boolean);
  ensure(values.length <= 30, 400, 'Trente compétences au plus');
  return values.map(item => boundedText(item, 120, 'Compétence'));
}

interface CourseRow { id: string; scope_id: string; title: string; state: string; author_id: string; pass_threshold: number; credential_type_id: string | null }
async function courseOf(store: Queryable, id: unknown, lock = false) {
  const { rows } = await store.query<CourseRow>(`SELECT id, scope_id, title, state, author_id, pass_threshold, credential_type_id FROM unoa.short_course WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Formation courte introuvable');
  return rows[0];
}
async function enrollmentOf(store: Queryable, id: unknown) {
  const { rows } = await store.query<{ id: string; state: string; account_id: string; session_id: string; course_id: string; scope_id: string; title: string; pass_threshold: number;
    credential_type_id: string | null; trainer_id: string | null; session: string }>(`
    SELECT enrollment.id, enrollment.state, enrollment.account_id, enrollment.session_id, course.id AS course_id, course.scope_id, course.title, course.pass_threshold,
      course.credential_type_id, session.trainer_id, session.label AS session
    FROM unoa.short_enrollment AS enrollment JOIN unoa.training_session AS session ON session.id = enrollment.session_id
    JOIN unoa.short_course AS course ON course.id = session.course_id WHERE enrollment.id = $1 FOR UPDATE OF enrollment`, [uuid(id)]);
  ensure(rows[0], 404, 'Inscription introuvable');
  return rows[0];
}
// A trainer acts on the sessions they lead, or anywhere with the trainer right.
async function requireTrainer(store: Queryable, actor: string, enrollment: { scope_id: string; trainer_id: string | null }) {
  const granted = await rights(store, actor, enrollment.scope_id);
  ensure(granted?.train || enrollment.trainer_id === actor, 403, 'Validation réservée au formateur de la session');
}

// Latest score per module, and whether the course is passed (all modules ≥ threshold).
async function progress(store: Queryable, enrollmentId: string, courseId: string, threshold: number) {
  const { rows } = await store.query<{ id: string; title: string; score: number | null }>(`SELECT module.id, module.title,
      (SELECT score FROM unoa.module_result WHERE enrollment_id = $1 AND module_id = module.id ORDER BY recorded_at DESC LIMIT 1) AS score
    FROM unoa.short_module AS module WHERE module.course_id = $2 ORDER BY module.ordinal`, [enrollmentId, courseId]);
  return { modules: rows, complete: rows.length > 0 && rows.every(row => row.score !== null), passed: rows.length > 0 && rows.every(row => row.score !== null && row.score >= threshold) };
}

// ---------------------------------------------------------------- catalogue

async function catalogueAction(store: Queryable, actor: string, action: string, input: Input) {
  if (action === 'courses') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'manage');
    const typeId = optional(input.credentialTypeId, uuid);
    if (typeId) {
      const type = await typeOf(store, typeId);
      ensure(type.eligibility === 'short_completion' && ['internal_attestation', 'badge'].includes(type.category), 422, 'Le document doit être une attestation ou un badge « formation courte réussie »');
      ensure((await store.query<{ ok: boolean }>('SELECT unoa.scope_within($1, $2) AS ok', [scopeId, type.scope_id])).rows[0].ok, 422, 'Document d’un autre établissement');
    }
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.short_course(scope_id, code, title, description, audience, duration_hours, competencies, pass_threshold, credential_type_id, author_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [scopeId, boundedText(input.code, 32, 'Code'), boundedText(input.title, 200, 'Intitulé'),
      boundedText(input.description, 6000, 'Description'), optional(input.audience, text(500, 'Public')), numeric(input.durationHours), competencies(input.competencies),
      integer(input.passThreshold ?? 50, 'Seuil de réussite', 0, 100), typeId, actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Ce code existe déjà');
      if (error?.code === '23514') throw new Problem(400, 'Durée invalide');
      throw error;
    });
    return { scopeId, subject: rows[0].id };
  }
  const course = await courseOf(store, input.courseId, true);
  if (action === 'modules') {
    await require(store, actor, course.scope_id, 'manage');
    ensure(course.state === 'draft', 409, 'Une formation publiée garde ses modules');
    const content = optional(input.contentVersionId, uuid);
    await store.query(`INSERT INTO unoa.short_module(course_id, ordinal, title, hours, competencies, content_version_id, licence)
      VALUES ($1, (SELECT coalesce(max(ordinal), 0) + 1 FROM unoa.short_module WHERE course_id = $1), $2, $3, $4, $5, $6)`, [course.id, boundedText(input.title, 200, 'Module'),
      numeric(input.hours), competencies(input.competencies), content, content ? boundedText(input.licence, 500, 'Licence de réutilisation') : optional(input.licence, text(500, 'Licence'))]).catch(error => {
      if (error?.code === '23514') throw new Problem(422, 'Seul un contenu validé (publié) se réutilise, avec sa licence');
      throw error;
    });
    return { scopeId: course.scope_id, subject: course.id };
  }
  if (action === 'publish' || action === 'archive') {
    await require(store, actor, course.scope_id, 'approve');
    if (action === 'publish') {
      ensure(course.state === 'draft', 409, 'Déjà publiée');
      ensure(course.author_id !== actor, 403, 'La publication revient à une autre personne que l’auteur');
      const { rows: [count] } = await store.query<{ total: number }>('SELECT count(*)::int AS total FROM unoa.short_module WHERE course_id = $1', [course.id]);
      ensure(count.total > 0, 422, 'Ajoutez au moins un module');
      await store.query("UPDATE unoa.short_course SET state = 'published', publisher_id = $2 WHERE id = $1", [course.id, actor]);
    } else {
      ensure(course.state === 'published', 409, 'Seule une formation publiée s’archive');
      await store.query("UPDATE unoa.short_course SET state = 'archived' WHERE id = $1", [course.id]);
    }
    return { scopeId: course.scope_id, subject: course.id };
  }
  if (action === 'sessions') {
    await require(store, actor, course.scope_id, 'manage');
    ensure(course.state === 'published', 422, 'Session d’une formation publiée');
    const ruleId = optional(input.priceRuleId, uuid);
    if (ruleId) ensure((await store.query("SELECT 1 FROM unoa.price_rule WHERE id = $1 AND state = 'published'", [ruleId])).rows[0], 422, 'Tarif non approuvé');
    const clientId = optional(input.clientId, uuid);
    if (clientId) ensure((await store.query('SELECT 1 FROM unoa.short_client WHERE id = $1 AND unoa.scope_within(scope_id, $2)', [clientId, course.scope_id])).rows[0], 404, 'Client introuvable');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.training_session(course_id, label, modality, starts_on, ends_on, capacity, price_rule_id, client_id, trainer_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [course.id, boundedText(input.label, 160, 'Session'), choice(input.modality, ['online', 'onsite', 'hybrid'] as const, 'Modalité'),
      day(input.startsOn, 'Début'), day(input.endsOn, 'Fin'), optional(input.capacity, value => integer(value, 'Capacité', 1, 100000)), ruleId, clientId, optional(input.trainerId, uuid), actor]).catch(error => {
      if (error?.code === '23514') throw new Problem(400, 'La fin suit le début');
      throw error;
    });
    return { scopeId: course.scope_id, subject: rows[0].id };
  }
  throw new Problem(404, 'Opération inconnue');
}

async function clientAction(store: Queryable, actor: string, action: string, input: Input) {
  if (action === 'clients') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'clients');
    const contact = await accountByEmail(store, input.contactEmail);
    const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.short_client(scope_id, name, registration, contact_account_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [scopeId, boundedText(input.name, 200, 'Raison sociale'), optional(input.registration, text(80, 'Identifiant légal')), contact, actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Client déjà enregistré');
      throw error;
    });
    return { scopeId, subject: rows[0].id };
  }
  throw new Problem(404, 'Opération inconnue');
}
async function accountByEmail(store: Queryable, email: unknown) {
  const value = boundedText(email, 254, 'Adresse électronique').toLowerCase();
  const { rows } = await store.query<{ id: string }>('SELECT id FROM unoa.account WHERE lower(email) = $1 AND disabled_at IS NULL', [value]);
  ensure(rows[0], 404, 'Aucun compte avec cette adresse : la personne crée d’abord son compte');
  return rows[0].id;
}

// -------------------------------------------------------------- enrolment

async function enrol(store: Queryable, actor: string, sessionId: string, account: string, clientId: string | null, correlation: string) {
  const { rows: [session] } = await store.query<{ id: string; state: string; capacity: number | null; client_id: string | null; course_id: string; scope_id: string; title: string; label: string;
    course_state: string; price_rule_id: string | null; ends_on: string; starts_on: string }>(`SELECT session.id, session.state, session.capacity, session.client_id, session.course_id, course.scope_id, course.title,
      session.label, course.state AS course_state, session.price_rule_id, session.ends_on::text, session.starts_on::text FROM unoa.training_session AS session
      JOIN unoa.short_course AS course ON course.id = session.course_id WHERE session.id = $1 FOR UPDATE OF session`, [sessionId]);
  ensure(session, 404, 'Session introuvable');
  ensure(session.state === 'open' && session.course_state === 'published' && session.ends_on >= new Date().toISOString().slice(0, 10), 409, 'Session close');
  ensure(session.client_id === clientId, 403, session.client_id ? 'Session réservée aux salariés du client' : 'Session ouverte au public');
  const { rows: [count] } = await store.query<{ total: number }>("SELECT count(*)::int AS total FROM unoa.short_enrollment WHERE session_id = $1 AND state <> 'withdrawn'", [session.id]);
  ensure(!session.capacity || count.total < session.capacity, 409, 'Session complète');
  const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.short_enrollment(session_id, account_id, client_id, enrolled_by) VALUES ($1, $2, $3, $4)
    ON CONFLICT (session_id, account_id) DO NOTHING RETURNING id`, [session.id, account, clientId, actor]);
  ensure(rows[0], 409, 'Déjà inscrit à cette session');
  await audit(store, actor, session.scope_id, 'short.enrolled', correlation, rows[0].id);
  await dispatch(store, { event: 'short.enrolled', scopeId: session.scope_id, recipients: [account], correlation, values: { course: session.title, session: session.label }, link: '/formations-courtes/mes' });
  return { enrollmentId: rows[0].id, priceRuleId: session.price_rule_id, scopeId: session.scope_id };
}

export async function learnerAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.short.learner.' + actor, async store => {
    if (action === 'enrol') return enrol(store, actor, uuid(input.sessionId), actor, null, correlation);
    if (action === 'withdraw') {
      const { rows } = await store.query<{ id: string }>("UPDATE unoa.short_enrollment SET state = 'withdrawn' WHERE id = $1 AND account_id = $2 AND state = 'enrolled' RETURNING id", [uuid(input.enrollmentId), actor]);
      ensure(rows[0], 409, 'Inscription introuvable ou déjà conclue');
      return { enrollmentId: rows[0].id };
    }
    if (action === 'feedback') {
      const enrollment = await enrollmentOf(store, input.enrollmentId);
      ensure(enrollment.account_id === actor, 403, 'Avis réservé à l’apprenant');
      ensure(['completed', 'not_passed'].includes(enrollment.state), 409, 'Avis après la fin de la formation');
      await store.query('INSERT INTO unoa.short_feedback(enrollment_id, rating, comment) VALUES ($1, $2, $3) ON CONFLICT (enrollment_id) DO NOTHING',
        [enrollment.id, integer(input.rating, 'Note', 1, 5), optional(input.comment, text(2000, 'Commentaire'))]);
      return { enrollmentId: enrollment.id };
    }
    if (action === 'rpl') {
      const courseId = optional(input.courseId, uuid);
      const scopeId = courseId ? (await courseOf(store, courseId)).scope_id : uuid(input.scopeId);
      const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.rpl_request(scope_id, account_id, course_id, target, experience) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [scopeId, actor, courseId, boundedText(input.target, 200, 'Formation ou compétence visée'), boundedText(input.experience, 6000, 'Expérience et acquis')]);
      await audit(store, actor, scopeId, 'short.rpl_submitted', correlation, rows[0].id);
      return { rplId: rows[0].id };
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

// --------------------------------------------------------------- staff side

async function trainingAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'enrol-employees') {
    const { rows: [client] } = await store.query<{ id: string; scope_id: string }>('SELECT id, scope_id FROM unoa.short_client WHERE id = $1', [uuid(input.clientId)]);
    ensure(client, 404, 'Client introuvable');
    await require(store, actor, client.scope_id, 'clients');
    const emails = String(input.emails ?? '').split(/[\s,;]+/).filter(Boolean);
    ensure(emails.length > 0 && emails.length <= 200, 400, 'De 1 à 200 adresses');
    let enrolled = 0;
    for (const email of emails) { await enrol(store, actor, uuid(input.sessionId), await accountByEmail(store, email), client.id, correlation); enrolled++; }
    return { scopeId: client.scope_id, enrolled };
  }
  const enrollment = await enrollmentOf(store, input.enrollmentId);
  if (action === 'results') {
    await requireTrainer(store, actor, enrollment);
    await store.query('INSERT INTO unoa.module_result(enrollment_id, module_id, score, evidence, recorded_by) VALUES ($1, $2, $3, $4, $5)',
      [enrollment.id, uuid(input.moduleId), integer(input.score, 'Score', 0, 100), boundedText(input.evidence, 2000, 'Preuve (épreuve, production, observation)'), actor]).catch(error => {
      if (error?.code === '23514') throw new Problem(422, 'Module d’une autre formation ou inscription close');
      throw error;
    });
    await audit(store, actor, enrollment.scope_id, 'short.result_recorded', correlation, enrollment.id);
    return { scopeId: enrollment.scope_id, subject: enrollment.id };
  }
  if (action === 'conclude') {
    await requireTrainer(store, actor, enrollment);
    ensure(enrollment.state === 'enrolled', 409, 'Inscription déjà conclue');
    const state = await progress(store, enrollment.id, enrollment.course_id, enrollment.pass_threshold);
    ensure(state.complete, 422, 'Parcours incomplet : chaque module doit avoir un résultat');
    const outcome = state.passed ? 'completed' : 'not_passed';
    await store.query('UPDATE unoa.short_enrollment SET state = $2, concluded_at = now() WHERE id = $1', [enrollment.id, outcome]);
    await audit(store, actor, enrollment.scope_id, 'short.' + outcome, correlation, enrollment.id);
    if (state.passed) await dispatch(store, { event: 'short.completed', scopeId: enrollment.scope_id, recipients: [enrollment.account_id], correlation, values: { course: enrollment.title }, link: '/formations-courtes/mes' });
    return { scopeId: enrollment.scope_id, subject: enrollment.id, outcome };
  }
  if (action === 'certify') {
    // Private attestation through the document register (SHORT-007), never a national title.
    await require(store, actor, enrollment.scope_id, 'manage');
    ensure(enrollment.state === 'completed', 422, 'Attestation réservée à une formation réussie');
    ensure(enrollment.credential_type_id, 422, 'Aucun document prévu pour cette formation');
    return certify(store, actor, enrollment.credential_type_id, enrollment.account_id, enrollment.id, { formation: enrollment.title, annee: enrollment.session }, input, correlation);
  }
  throw new Problem(404, 'Opération inconnue');
}

async function certify(store: Queryable, actor: string, typeId: string, holder: string, source: string, values: Record<string, string>, input: Input, correlation: string) {
  const type = await typeOf(store, typeId);
  ensure(type.state === 'published', 422, 'Type de document non approuvé');
  const { rows: [issue] } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'cred.issue', $2) AS ok", [actor, type.scope_id]);
  ensure(issue.ok, 403, 'La préparation du document revient aux personnes habilitées pour les documents');
  const lang = language(input.language ?? 'fr');
  const { rows: [holderRow] } = await store.query<{ name: string | null; institution: string }>('SELECT account.display_name AS name, scope.label AS institution FROM unoa.account, unoa.scope WHERE account.id = $1 AND scope.id = $2', [holder, type.scope_id]);
  const { rows: [previous] } = await store.query<{ id: string }>("SELECT id FROM unoa.credential WHERE type_id = $1 AND source_id = $2 AND state = 'revoked' ORDER BY created_at DESC LIMIT 1", [type.id, source]);
  return seal(store, actor, type, { holder, student: null, source, language: lang, template: await templateFor(store, type.id, lang), authority: type.issuing_authority,
    replaces: previous?.id ?? null, correlation, values: { nom: holderRow.name ?? '', matricule: '', etablissement: holderRow.institution, credits: '', ...values } });
}

async function stackAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'stacks') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'manage');
    const courses = list(input.courseIds, 20).map(uuid);
    ensure(new Set(courses).size === courses.length && courses.length >= 2, 400, 'Au moins deux formations distinctes');
    const { rows: [found] } = await store.query<{ total: number }>("SELECT count(*)::int AS total FROM unoa.short_course WHERE id = ANY($1::uuid[]) AND state = 'published' AND unoa.scope_within(scope_id, $2)", [courses, scopeId]);
    ensure(found.total === courses.length, 422, 'Formations publiées de ce périmètre uniquement');
    const type = await typeOf(store, input.credentialTypeId);
    ensure(type.eligibility === 'stack_completion' && type.category === 'badge', 422, 'Le document doit être un badge « parcours complet »');
    const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.credential_stack(scope_id, title, course_ids, credential_type_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [scopeId, boundedText(input.title, 200, 'Parcours'), courses, type.id, actor]);
    return { scopeId, subject: rows[0].id };
  }
  if (action === 'certify-stack') {
    const { rows: [stack] } = await store.query<{ id: string; scope_id: string; title: string; course_ids: string[]; credential_type_id: string }>('SELECT * FROM unoa.credential_stack WHERE id = $1', [uuid(input.stackId)]);
    ensure(stack, 404, 'Parcours introuvable');
    await require(store, actor, stack.scope_id, 'manage');
    const account = uuid(input.accountId);
    const { rows: [done] } = await store.query<{ total: number }>(`SELECT count(DISTINCT session.course_id)::int AS total FROM unoa.short_enrollment AS enrollment
      JOIN unoa.training_session AS session ON session.id = enrollment.session_id WHERE enrollment.account_id = $1 AND enrollment.state = 'completed' AND session.course_id = ANY($2::uuid[])`, [account, stack.course_ids]);
    ensure(done.total === stack.course_ids.length, 422, `Parcours incomplet : ${done.total} formation(s) réussie(s) sur ${stack.course_ids.length}`);
    // The stack's source is a stable identifier for the holder and the stack.
    const { rows: [source] } = await store.query<{ id: string }>("SELECT md5($1 || ':' || $2)::uuid AS id", [stack.id, account]);
    return certify(store, actor, stack.credential_type_id, account, source.id, { formation: stack.title, annee: String(new Date().getUTCFullYear()) }, input, correlation);
  }
  throw new Problem(404, 'Opération inconnue');
}

async function rplDecision(store: Queryable, actor: string, input: Input, correlation: string) {
  const { rows: [request] } = await store.query<{ id: string; scope_id: string; account_id: string; state: string; target: string }>('SELECT id, scope_id, account_id, state, target FROM unoa.rpl_request WHERE id = $1 FOR UPDATE', [uuid(input.rplId)]);
  ensure(request, 404, 'Demande introuvable');
  await require(store, actor, request.scope_id, 'rpl');
  ensure(request.account_id !== actor, 403, 'Une demande est examinée par une autre personne');
  const decision = choice(input.decision, ['in_review', 'accepted', 'partially_accepted', 'rejected'] as const, 'Décision');
  ensure(['submitted', 'in_review'].includes(request.state), 409, 'Demande déjà tranchée');
  if (decision === 'in_review') await store.query("UPDATE unoa.rpl_request SET state = 'in_review', reviewer_id = $2 WHERE id = $1", [request.id, actor]);
  else {
    await store.query('UPDATE unoa.rpl_request SET state = $2, reviewer_id = $3, decision = $4, decided_at = now() WHERE id = $1', [request.id, decision, actor, boundedText(input.reason, 4000, 'Motivation')]);
    await dispatch(store, { event: 'short.rpl_decided', scopeId: request.scope_id, recipients: [request.account_id], correlation, values: { target: request.target, decision: rplStates[decision] }, link: '/formations-courtes/mes' });
  }
  return { scopeId: request.scope_id, subject: request.id };
}

export async function shortAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.short.' + action, async store => {
    let result: { scopeId?: string; subject?: string; [key: string]: unknown };
    if (['courses', 'modules', 'publish', 'archive', 'sessions'].includes(action)) result = await catalogueAction(store, actor, action, input);
    else if (action === 'clients') result = await clientAction(store, actor, action, input);
    else if (['enrol-employees', 'results', 'conclude', 'certify'].includes(action)) return trainingAction(store, actor, action, input, correlation);
    else if (action === 'stacks' || action === 'certify-stack') return stackAction(store, actor, action, input, correlation);
    else if (action === 'decide-rpl') result = await rplDecision(store, actor, input, correlation);
    else throw new Problem(404, 'Opération inconnue');
    await audit(store, actor, result.scopeId ?? null, 'short.' + action.replace(/-/g, '_'), correlation, result.subject ?? null);
    return result;
  });
}

// --------------------------------------------------------------------- views

export async function publicCatalogue(settings: IamSettings, siteScope: string | null) {
  const { rows } = await database(settings).query<{ id: string; code: string; title: string; description: string; audience: string | null; duration_hours: string; competencies: string[];
    scope_label: string; sessions: { id: string; label: string; modality: string; starts_on: string; ends_on: string; seats: number | null; price: string | null; currency: string | null }[];
    modules: { title: string; hours: number }[] }>(`
    SELECT course.id, course.code, course.title, course.description, course.audience, course.duration_hours, course.competencies, scope.label AS scope_label,
      coalesce((SELECT jsonb_agg(jsonb_build_object('title', title, 'hours', hours) ORDER BY ordinal) FROM unoa.short_module WHERE course_id = course.id), '[]') AS modules,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', session.id, 'label', session.label, 'modality', session.modality, 'starts_on', session.starts_on, 'ends_on', session.ends_on,
        'seats', CASE WHEN session.capacity IS NULL THEN NULL ELSE session.capacity - (SELECT count(*) FROM unoa.short_enrollment WHERE session_id = session.id AND state <> 'withdrawn') END,
        'price', rule.amount_minor, 'currency', rule.currency) ORDER BY session.starts_on)
        FROM unoa.training_session AS session LEFT JOIN unoa.price_rule AS rule ON rule.id = session.price_rule_id
        WHERE session.course_id = course.id AND session.state = 'open' AND session.client_id IS NULL AND session.ends_on >= current_date), '[]') AS sessions
    FROM unoa.short_course AS course JOIN unoa.scope ON scope.id = course.scope_id WHERE course.state = 'published'
      AND ($1::uuid IS NULL OR unoa.scope_within(course.scope_id, $1) OR unoa.scope_within($1, course.scope_id)) ORDER BY course.title LIMIT 200`, [siteScope]);
  return rows.map(row => ({ ...row, sessions: row.sessions.map(session => ({ ...session, priceText: session.price && session.currency ? money(session.price, session.currency) : 'Gratuit' })) }));
}

export async function mySpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const { rows: enrollments } = await store.query<{ id: string; state: string; course_id: string; title: string; session: string; modality: string; pass_threshold: number;
    starts_on: string; ends_on: string; rated: boolean; certificate: string | null }>(`
    SELECT enrollment.id, enrollment.state, course.id AS course_id, course.title, session.label AS session, session.modality, course.pass_threshold, session.starts_on::text, session.ends_on::text,
      EXISTS (SELECT 1 FROM unoa.short_feedback WHERE enrollment_id = enrollment.id) AS rated,
      (SELECT credential.id FROM unoa.credential WHERE credential.source_id = enrollment.id AND credential.state = 'issued' LIMIT 1) AS certificate
    FROM unoa.short_enrollment AS enrollment JOIN unoa.training_session AS session ON session.id = enrollment.session_id JOIN unoa.short_course AS course ON course.id = session.course_id
    WHERE enrollment.account_id = $1 ORDER BY session.starts_on DESC`, [actor]);
  const detailed = [];
  for (const item of enrollments) detailed.push({ ...item, progress: await progress(store, item.id, item.course_id, item.pass_threshold) });
  const { rows: rpl } = await store.query<{ id: string; target: string; state: string; decision: string | null; submitted_at: Date }>(
    'SELECT id, target, state, decision, submitted_at FROM unoa.rpl_request WHERE account_id = $1 ORDER BY submitted_at DESC', [actor]);
  return { enrollments: detailed, rpl };
}

export async function shortContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('institution', 'academic_unit') AND (unoa.has_scope_permission($1, 'short.read', scope.id)) ORDER BY kind.nature, scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function shortOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const [label, courses, modules, sessions, enrollments, clients, stacks, rpl, types, contents, rules, report] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; code: string; title: string; state: string; author_id: string; duration_hours: string; pass_threshold: number; competencies: string[]; credential: string | null }>(`
      SELECT course.id, course.code, course.title, course.state, course.author_id, course.duration_hours, course.pass_threshold, course.competencies, kind.label AS credential
      FROM unoa.short_course AS course LEFT JOIN unoa.credential_type AS kind ON kind.id = course.credential_type_id WHERE unoa.scope_within(course.scope_id, $1) ORDER BY course.created_at DESC`, [scopeId]),
    store.query<{ id: string; course_id: string; ordinal: number; title: string; hours: string; licence: string | null; content: string | null }>(`SELECT module.id, module.course_id, module.ordinal,
      module.title, module.hours, module.licence, version.title AS content FROM unoa.short_module AS module JOIN unoa.short_course AS course ON course.id = module.course_id
      LEFT JOIN unoa.course_version AS version ON version.id = module.content_version_id WHERE unoa.scope_within(course.scope_id, $1) ORDER BY module.course_id, module.ordinal`, [scopeId]),
    store.query<{ id: string; course_id: string; label: string; modality: string; starts_on: string; ends_on: string; capacity: number | null; client: string | null; client_id: string | null; trainer: string | null }>(`
      SELECT session.id, session.course_id, session.label, session.modality, session.starts_on::text, session.ends_on::text, session.capacity, client.name AS client, session.client_id,
        trainer.display_name AS trainer FROM unoa.training_session AS session JOIN unoa.short_course AS course ON course.id = session.course_id
      LEFT JOIN unoa.short_client AS client ON client.id = session.client_id LEFT JOIN unoa.account AS trainer ON trainer.id = session.trainer_id
      WHERE unoa.scope_within(course.scope_id, $1) ORDER BY session.starts_on DESC LIMIT 200`, [scopeId]),
    store.query<{ id: string; session_id: string; course_id: string; name: string | null; state: string; client: string | null; account_id: string; certificate: string | null }>(`
      SELECT enrollment.id, enrollment.session_id, session.course_id, account.display_name AS name, enrollment.state, client.name AS client, enrollment.account_id,
        (SELECT credential.number FROM unoa.credential WHERE credential.source_id = enrollment.id AND credential.state <> 'revoked' LIMIT 1) AS certificate
      FROM unoa.short_enrollment AS enrollment JOIN unoa.training_session AS session ON session.id = enrollment.session_id JOIN unoa.short_course AS course ON course.id = session.course_id
      JOIN unoa.account ON account.id = enrollment.account_id LEFT JOIN unoa.short_client AS client ON client.id = enrollment.client_id
      WHERE unoa.scope_within(course.scope_id, $1) ORDER BY enrollment.enrolled_at DESC LIMIT 500`, [scopeId]),
    store.query<{ id: string; name: string; registration: string | null; contact: string | null }>(`SELECT client.id, client.name, client.registration, account.display_name AS contact FROM unoa.short_client AS client
      JOIN unoa.account ON account.id = client.contact_account_id WHERE unoa.scope_within(client.scope_id, $1) ORDER BY client.name`, [scopeId]),
    store.query<{ id: string; title: string; course_ids: string[]; credential: string }>(`SELECT stack.id, stack.title, stack.course_ids, kind.label AS credential FROM unoa.credential_stack AS stack
      JOIN unoa.credential_type AS kind ON kind.id = stack.credential_type_id WHERE unoa.scope_within(stack.scope_id, $1)`, [scopeId]),
    store.query<{ id: string; name: string | null; target: string; experience: string; state: string; decision: string | null; account_id: string }>(`SELECT request.id, account.display_name AS name,
      request.target, request.experience, request.state, request.decision, request.account_id FROM unoa.rpl_request AS request JOIN unoa.account ON account.id = request.account_id
      WHERE unoa.scope_within(request.scope_id, $1) ORDER BY request.submitted_at DESC LIMIT 200`, [scopeId]),
    store.query<{ id: string; label: string; eligibility: string }>(`SELECT id, label, eligibility FROM unoa.credential_type WHERE state = 'published' AND eligibility IN ('short_completion', 'stack_completion')
      AND (unoa.scope_within(scope_id, $1) OR unoa.scope_within($1, scope_id))`, [scopeId]),
    store.query<{ id: string; title: string }>(`SELECT version.id, version.title || ' (v' || version.number || ')' AS title FROM unoa.course_version AS version JOIN unoa.course ON course.id = version.course_id
      WHERE version.state = 'published' AND (unoa.scope_within(course.owner_scope_id, $1) OR unoa.scope_within($1, course.owner_scope_id)) ORDER BY version.title LIMIT 200`, [scopeId]),
    store.query<{ id: string; label: string }>(`SELECT id, label FROM unoa.price_rule WHERE state = 'published' AND (unoa.scope_within(scope_id, $1) OR unoa.scope_within($1, scope_id)) ORDER BY label`, [scopeId]),
    // Participation and quality (SHORT-010).
    store.query<{ course_id: string; title: string; enrolled: number; completed: number; not_passed: number; withdrawn: number; rating: string | null; ratings: number }>(`
      SELECT course.id AS course_id, course.title, count(enrollment.id)::int AS enrolled, count(*) FILTER (WHERE enrollment.state = 'completed')::int AS completed,
        count(*) FILTER (WHERE enrollment.state = 'not_passed')::int AS not_passed, count(*) FILTER (WHERE enrollment.state = 'withdrawn')::int AS withdrawn,
        round(avg(feedback.rating), 2) AS rating, count(feedback.rating)::int AS ratings
      FROM unoa.short_course AS course LEFT JOIN unoa.training_session AS session ON session.course_id = course.id LEFT JOIN unoa.short_enrollment AS enrollment ON enrollment.session_id = session.id
      LEFT JOIN unoa.short_feedback AS feedback ON feedback.enrollment_id = enrollment.id WHERE unoa.scope_within(course.scope_id, $1) GROUP BY course.id, course.title ORDER BY course.title`, [scopeId]),
  ]);
  ensure(label.rows[0], 404, 'Portée introuvable');
  return { scope: { id: scopeId, label: label.rows[0].label }, rights: granted, courses: courses.rows, modules: modules.rows, sessions: sessions.rows, enrollments: enrollments.rows,
    clients: clients.rows, stacks: stacks.rows, rpl: rpl.rows, types: types.rows, contents: contents.rows, rules: rules.rows, report: report.rows };
}

export async function enrollmentProgress(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const enrollment = await enrollmentOf(store, id);
  const granted = await rights(store, actor, enrollment.scope_id);
  ensure(enrollment.account_id === actor || granted?.read || enrollment.trainer_id === actor, 403, 'Progression réservée');
  const state = await progress(store, enrollment.id, enrollment.course_id, enrollment.pass_threshold);
  const { rows: history } = await store.query<{ module: string; score: number; evidence: string; recorded_at: Date; trainer: string | null }>(`SELECT module.title AS module, result.score, result.evidence,
    result.recorded_at, account.display_name AS trainer FROM unoa.module_result AS result JOIN unoa.short_module AS module ON module.id = result.module_id
    JOIN unoa.account ON account.id = result.recorded_by WHERE result.enrollment_id = $1 ORDER BY result.recorded_at`, [enrollment.id]);
  return { enrollment, ...state, history };
}

const csv = (rows: (string | number | null)[][]) => '﻿' + rows.map(row => row.map(cell => {
  const value = cell === null ? '' : String(cell);
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}).join(';')).join('\n');

export async function participationCsv(settings: IamSettings, actor: string, scope: string) {
  const data = await shortOverview(settings, actor, scope);
  return csv([['Formation', 'Inscrits', 'Réussis', 'Non réussis', 'Retraits', 'Taux de réussite', 'Satisfaction moyenne (1-5)', 'Avis'],
    ...data.report.map(row => [row.title, row.enrolled, row.completed, row.not_passed, row.withdrawn, row.enrolled ? `${Math.round(100 * row.completed / row.enrolled)} %` : '—', row.rating, row.ratings])]);
}
