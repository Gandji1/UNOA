import 'server-only';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, integer, optional, Problem, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';
import { director, integrityClear, projectOf, ruleOf, type ProjectRow } from '@/lib/theses/store';

// Doctorate (module PHD). The thesis itself, its supervision, drafts, jury,
// defence and archive are the shared thesis model; this module adds the
// doctoral school, admission, enrolment, monitoring and authorisation to defend.

type Right = 'read' | 'manage' | 'decide' | 'authorize' | 'ethics';
export const reviewLabels: Record<string, string> = { continue: 'Poursuite', continue_with_conditions: 'Poursuite sous conditions', stop: 'Arrêt' };
export const ethicsLabels: Record<string, string> = { approved: 'Favorable', conditions: 'Favorable sous conditions', refused: 'Défavorable' };
const year = /^[0-9]{4}-[0-9]{4}$/;

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`SELECT unoa.has_scope_permission($1, 'phd.read', $2) AS read, unoa.has_scope_permission($1, 'phd.manage', $2) AS manage,
    unoa.has_scope_permission($1, 'phd.decide', $2) AS decide, unoa.has_scope_permission($1, 'phd.authorize', $2) AS authorize, unoa.has_scope_permission($1, 'phd.ethics', $2) AS ethics`, [actor, scopeId]);
  return rows[0];
}
async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée à l’école doctorale');
  return granted;
}
const academicYear = (input: unknown) => { ensure(typeof input === 'string' && year.test(input), 400, 'Année universitaire AAAA-AAAA'); return input; };

async function doctoralOf(store: Queryable, id: unknown) {
  const project = await projectOf(store, id, true);
  ensure(project.level === 'doctorat', 404, 'Thèse introuvable');
  const { rows: [meta] } = await store.query<{ school_id: string; lab_id: string; ethics_needed: boolean; started_on: string }>('SELECT school_id, lab_id, ethics_needed, started_on::text FROM unoa.doctoral_project WHERE project_id = $1', [project.id]);
  ensure(meta, 404, 'Dossier doctoral introuvable');
  return { project, meta };
}
export async function activeEnrollment(store: Queryable, projectId: string) {
  const { rows } = await store.query<{ academic_year: string; valid_until: string }>('SELECT academic_year, valid_until::text FROM unoa.doctoral_enrollment WHERE project_id = $1 AND valid_from <= current_date AND valid_until >= current_date LIMIT 1', [projectId]);
  return rows[0] ?? null;
}
async function trainingHours(store: Queryable, projectId: string) {
  const { rows: [sum] } = await store.query<{ total: number }>('SELECT coalesce(sum(hours), 0)::int AS total FROM unoa.doctoral_training WHERE project_id = $1 AND validated_by IS NOT NULL', [projectId]);
  return sum.total;
}
async function ethicsState(store: Queryable, projectId: string) {
  const { rows } = await store.query<{ decision: string }>('SELECT decision FROM unoa.ethics_review WHERE project_id = $1 ORDER BY recorded_at DESC LIMIT 1', [projectId]);
  return rows[0]?.decision ?? null;
}
// Conditions to defend (PHD-010), each one stated.
export async function defenseConditions(store: Queryable, project: ProjectRow, meta: { ethics_needed: boolean }) {
  const rule = await ruleOf(store, project);
  const enrollment = await activeEnrollment(store, project.id);
  const hours = await trainingHours(store, project.id);
  const ethics = await ethicsState(store, project.id);
  const ethicsRequired = rule.ethics_required || meta.ethics_needed;
  const { rows: [stopped] } = await store.query("SELECT 1 FROM unoa.progress_review WHERE project_id = $1 AND decision = 'stop'", [project.id]);
  const conditions = [
    { label: 'Inscription en cours de validité', met: !!enrollment },
    { label: 'Directeur de thèse en fonction', met: !!(await director(store, project.id)) },
    { label: `Formations doctorales validées : ${hours} h / ${rule.training_hours ?? 0} h`, met: hours >= (rule.training_hours ?? 0) },
    { label: ethicsRequired ? `Avis éthique favorable (${ethics ? ethicsLabels[ethics].toLowerCase() : 'absent'})` : 'Avis éthique non requis', met: !ethicsRequired || ethics === 'approved' || ethics === 'conditions' },
    { label: 'Aucune décision d’arrêt du comité de suivi', met: !stopped },
    { label: 'Dernière version contrôlée sans suspicion de plagiat', met: (await integrityClear(store, project.id)) === 'clear' },
  ];
  return conditions;
}

async function schoolAction(store: Queryable, actor: string, action: string, input: Input) {
  if (action === 'schools') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'manage');
    ensure((await store.query("SELECT 1 FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE scope.id = $1 AND kind.nature = 'institution'", [scopeId])).rows[0], 422, 'Une école doctorale relève d’un établissement');
    const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.doctoral_school(scope_id, name, director_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [scopeId, boundedText(input.name, 200, 'École doctorale'), optional(input.directorId, uuid), actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Cette école existe déjà');
      throw error;
    });
    return { scopeId, subject: rows[0].id };
  }
  if (action === 'labs') {
    const { rows: [school] } = await store.query<{ id: string; scope_id: string }>('SELECT id, scope_id FROM unoa.doctoral_school WHERE id = $1', [uuid(input.schoolId)]);
    ensure(school, 404, 'École doctorale introuvable');
    await require(store, actor, school.scope_id, 'manage');
    const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.doctoral_lab(school_id, code, name, head_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [school.id, boundedText(input.code, 32, 'Code'), boundedText(input.name, 200, 'Laboratoire'), optional(input.headId, uuid)]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Ce code existe déjà');
      if (error?.code === '23514') throw new Problem(400, 'Code invalide');
      throw error;
    });
    return { scopeId: school.scope_id, subject: rows[0].id };
  }
  throw new Problem(404, 'Opération inconnue');
}

async function admission(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'apply') {
    const { rows: [lab] } = await store.query<{ id: string; school_id: string; scope_id: string }>(`SELECT lab.id, lab.school_id, school.scope_id FROM unoa.doctoral_lab AS lab
      JOIN unoa.doctoral_school AS school ON school.id = lab.school_id WHERE lab.id = $1`, [uuid(input.labId)]);
    ensure(lab, 404, 'Laboratoire introuvable');
    const proposed = uuid(input.proposedDirectorId);
    const { rows: [qualified] } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'phd.direct', $2) AS ok", [proposed, lab.scope_id]);
    ensure(qualified.ok, 422, 'Le directeur proposé doit être habilité à diriger des recherches');
    ensure(proposed !== actor, 422, 'Un candidat ne dirige pas sa propre thèse');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.doctoral_application(school_id, lab_id, account_id, title, dossier, funding, proposed_director_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [lab.school_id, lab.id, actor, boundedText(input.title, 300, 'Titre du projet'), boundedText(input.dossier, 20000, 'Dossier scientifique'),
      optional(input.funding, text(2000, 'Financement')), proposed]);
    await audit(store, actor, lab.scope_id, 'phd.applied', correlation, rows[0].id);
    return { applicationId: rows[0].id };
  }
  const { rows: [application] } = await store.query<{ id: string; school_id: string; lab_id: string; account_id: string; title: string; dossier: string; funding: string | null;
    proposed_director_id: string; state: string; scope_id: string }>(`SELECT application.*, school.scope_id FROM unoa.doctoral_application AS application
    JOIN unoa.doctoral_school AS school ON school.id = application.school_id WHERE application.id = $1 FOR UPDATE OF application`, [uuid(input.applicationId)]);
  ensure(application, 404, 'Candidature introuvable');
  await require(store, actor, application.scope_id, 'decide');
  ensure(application.state === 'submitted', 409, 'Candidature déjà décidée');
  ensure(application.account_id !== actor && application.proposed_director_id !== actor, 403, 'La décision revient à une personne extérieure au projet');
  const decision = choice(input.decision, ['accepted', 'rejected'] as const, 'Décision');
  const funding = application.funding ? choice(input.fundingStatus ?? 'validated', ['validated', 'refused'] as const, 'Financement') : 'none';
  if (decision === 'rejected') {
    await store.query("UPDATE unoa.doctoral_application SET state = 'rejected', funding_status = $2, decided_by = $3, decision_note = $4, decided_at = now() WHERE id = $1",
      [application.id, funding, actor, boundedText(input.note, 2000, 'Motif')]);
  } else {
    // Admission creates the thesis (validated project), its director and the first enrolment.
    const first = academicYear(input.academicYear);
    const { rows: [project] } = await store.query<{ id: string }>(`INSERT INTO unoa.thesis_project(scope_id, level, author_id, title, protocol, state, validated_by, validation_note)
      VALUES ($1, 'doctorat', $2, $3, $4, 'validated', $5, $6) RETURNING id`, [application.scope_id, application.account_id, application.title, application.dossier, actor, optional(input.note, text(2000, 'Observation'))]);
    await store.query("INSERT INTO unoa.supervision(project_id, account_id, role, qualification, assigned_by) VALUES ($1, $2, 'director', 'Habilitation à diriger des recherches', $3)",
      [project.id, application.proposed_director_id, actor]);
    await store.query('INSERT INTO unoa.doctoral_project(project_id, school_id, lab_id, funding, ethics_needed, started_on) VALUES ($1, $2, $3, $4, $5, current_date)',
      [project.id, application.school_id, application.lab_id, funding === 'validated' ? application.funding : null, flag(input.ethicsNeeded)]);
    await store.query(`INSERT INTO unoa.doctoral_enrollment(project_id, academic_year, valid_from, valid_until, enrolled_by) VALUES ($1, $2, current_date, current_date + 365, $3)`, [project.id, first, actor]);
    await store.query("UPDATE unoa.doctoral_application SET state = 'accepted', funding_status = $2, decided_by = $3, decision_note = $4, decided_at = now(), project_id = $5 WHERE id = $1",
      [application.id, funding, actor, optional(input.note, text(2000, 'Observation')), project.id]);
  }
  await audit(store, actor, application.scope_id, 'phd.admission_' + decision, correlation, application.id);
  await dispatch(store, { event: 'phd.admission', scopeId: application.scope_id, recipients: [application.account_id], correlation,
    values: { title: application.title, decision: decision === 'accepted' ? 'admission prononcée' : 'candidature non retenue' }, link: '/doctorat' });
  return { scopeId: application.scope_id, applicationId: application.id };
}

async function followUp(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  const { project, meta } = await doctoralOf(store, input.projectId);
  const granted = await rights(store, actor, project.scope_id);
  const done = { projectId: project.id, scopeId: project.scope_id };
  if (action === 'reenrol') {
    ensure(granted?.manage, 403, 'Réinscription par l’école doctorale');
    const rule = await ruleOf(store, project);
    const { rows: enrollments } = await store.query<{ academic_year: string }>('SELECT academic_year FROM unoa.doctoral_enrollment WHERE project_id = $1 ORDER BY academic_year', [project.id]);
    ensure(enrollments.length < (rule.max_years ?? Infinity), 422, `Durée maximale atteinte (${rule.max_years} inscriptions) : dérogation par le conseil compétent`);
    const last = enrollments[enrollments.length - 1]?.academic_year;
    const { rows: [review] } = await store.query<{ decision: string | null }>('SELECT decision FROM unoa.progress_review WHERE project_id = $1 AND academic_year = $2', [project.id, last]);
    ensure(review?.decision && review.decision !== 'stop', 422, 'Réinscription après un avis favorable du comité de suivi sur l’année écoulée');
    await store.query('INSERT INTO unoa.doctoral_enrollment(project_id, academic_year, valid_from, valid_until, enrolled_by) VALUES ($1, $2, $3, $4, $5)',
      [project.id, academicYear(input.academicYear), day(input.validFrom, 'Début'), day(input.validUntil, 'Fin'), actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Déjà inscrit pour cette année');
      if (error?.code === '23514') throw new Problem(400, 'Période invalide');
      throw error;
    });
  } else if (action === 'committee') {
    ensure(granted?.manage, 403, 'Comité désigné par l’école doctorale');
    await store.query('INSERT INTO unoa.committee_member(project_id, account_id, added_by) VALUES ($1, $2, $3)', [project.id, uuid(input.accountId), actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Déjà membre du comité');
      throw error;
    });
  } else if (action === 'annual-report') {
    ensure(project.author_id === actor, 403, 'Rapport déposé par le doctorant');
    ensure(await activeEnrollment(store, project.id), 422, 'Inscription périmée : réinscription requise');
    ensure(await director(store, project.id), 422, 'Supervision interrompue : un directeur doit être désigné');
    await store.query('INSERT INTO unoa.progress_review(project_id, academic_year, report) VALUES ($1, $2, $3)', [project.id, academicYear(input.academicYear), boundedText(input.report, 20000, 'Rapport annuel')]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Rapport déjà déposé pour cette année');
      throw error;
    });
  } else if (action === 'review') {
    ensure((await store.query('SELECT 1 FROM unoa.committee_member WHERE project_id = $1 AND account_id = $2', [project.id, actor])).rows[0], 403, 'Décision réservée au comité de suivi');
    const decision = choice(input.decision, ['continue', 'continue_with_conditions', 'stop'] as const, 'Décision');
    const { rowCount } = await store.query('UPDATE unoa.progress_review SET opinion = $3, decision = $4, decided_by = $5, decided_at = now() WHERE project_id = $1 AND academic_year = $2 AND decision IS NULL',
      [project.id, academicYear(input.academicYear), boundedText(input.opinion, 8000, 'Avis motivé'), decision, actor]);
    ensure(rowCount, 409, 'Aucun rapport en attente pour cette année');
    await dispatch(store, { event: 'phd.review', scopeId: project.scope_id, recipients: [project.author_id], correlation, values: { year: String(input.academicYear), decision: reviewLabels[decision] }, link: '/doctorat' });
  } else if (action === 'trainings') {
    ensure(project.author_id === actor, 403, 'Formation déclarée par le doctorant');
    await store.query('INSERT INTO unoa.doctoral_training(project_id, kind, title, hours, evidence) VALUES ($1, $2, $3, $4, $5)', [project.id,
      choice(input.kind, ['course', 'seminar', 'school', 'other'] as const, 'Nature'), boundedText(input.title, 300, 'Intitulé'), integer(input.hours, 'Heures', 1, 500), boundedText(input.evidence, 1000, 'Justificatif')]);
  } else if (action === 'validate-training') {
    ensure(granted?.manage, 403, 'Validation par l’école doctorale');
    const { rowCount } = await store.query('UPDATE unoa.doctoral_training SET validated_by = $3, validated_at = now() WHERE id = $1 AND project_id = $2 AND validated_by IS NULL', [uuid(input.trainingId), project.id, actor]);
    ensure(rowCount, 409, 'Formation introuvable ou déjà validée');
  } else if (action === 'publications') {
    ensure(project.author_id === actor || (await director(store, project.id)) === actor, 403, 'Publication déclarée par le doctorant ou son directeur');
    await store.query('INSERT INTO unoa.publication(project_id, kind, title, venue, year, status, doi) VALUES ($1, $2, $3, $4, $5, $6, $7)', [project.id,
      choice(input.kind, ['article', 'conference', 'poster', 'book', 'other'] as const, 'Nature'), boundedText(input.title, 400, 'Titre'), boundedText(input.venue, 300, 'Revue ou manifestation'),
      integer(input.year, 'Année', 1900, 2200), choice(input.status, ['submitted', 'accepted', 'published'] as const, 'Statut'), optional(input.doi, text(200, 'DOI'))]).catch(error => {
      if (error?.code === '23514') throw new Problem(400, 'DOI invalide (10.xxxx/…)');
      throw error;
    });
  } else if (action === 'ethics') {
    ensure(granted?.ethics, 403, 'Avis éthique enregistré par une personne habilitée');
    await store.query('INSERT INTO unoa.ethics_review(project_id, committee, reference, decision, note, recorded_by) VALUES ($1, $2, $3, $4, $5, $6)', [project.id,
      boundedText(input.committee, 200, 'Comité d’éthique'), boundedText(input.reference, 120, 'Référence de l’avis'), choice(input.decision, ['approved', 'conditions', 'refused'] as const, 'Avis'),
      boundedText(input.note, 4000, 'Observations'), actor]);
  } else if (action === 'authorize') {
    ensure(granted?.authorize, 403, 'Autorisation de soutenance réservée');
    ensure(project.author_id !== actor && (await director(store, project.id)) !== actor, 403, 'L’autorisation revient à une personne extérieure à la thèse');
    const conditions = await defenseConditions(store, project, meta);
    const missing = conditions.filter(item => !item.met);
    ensure(missing.length === 0, 422, 'Conditions non remplies : ' + missing.map(item => item.label).join(' ; '));
    await store.query('INSERT INTO unoa.defense_authorization(project_id, authorized_by, conditions) VALUES ($1, $2, $3)', [project.id, actor, conditions.map(item => item.label).join(' ; ')]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Soutenance déjà autorisée');
      throw error;
    });
    await dispatch(store, { event: 'phd.authorized', scopeId: project.scope_id, recipients: [project.author_id], correlation, values: { title: project.title }, link: '/memoires/projet?id=' + project.id });
  } else throw new Problem(404, 'Opération inconnue');
  await audit(store, actor, project.scope_id, 'phd.' + action.replace(/-/g, '_'), correlation, project.id);
  return done;
}

export async function phdAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.phd.' + action, async store => {
    if (action === 'schools' || action === 'labs') {
      const result = await schoolAction(store, actor, action, input);
      await audit(store, actor, result.scopeId, 'phd.' + action, correlation, result.subject);
      return result;
    }
    if (action === 'apply' || action === 'decide') return admission(store, actor, action, input, correlation);
    return followUp(store, actor, action, input, correlation);
  });
}

// ------------------------------------------------------------------- views

async function dossier(store: Queryable, projectId: string) {
  const { project, meta } = await doctoralOf(store, projectId);
  const [school, enrollments, committee, reviews, trainings, publications, ethics, authorization] = await Promise.all([
    store.query<{ school: string; lab: string }>('SELECT school.name AS school, lab.name AS lab FROM unoa.doctoral_school AS school, unoa.doctoral_lab AS lab WHERE school.id = $1 AND lab.id = $2', [meta.school_id, meta.lab_id]),
    store.query<{ academic_year: string; valid_from: string; valid_until: string }>('SELECT academic_year, valid_from::text, valid_until::text FROM unoa.doctoral_enrollment WHERE project_id = $1 ORDER BY academic_year', [project.id]),
    store.query<{ account_id: string; name: string | null }>('SELECT member.account_id, account.display_name AS name FROM unoa.committee_member AS member JOIN unoa.account ON account.id = member.account_id WHERE member.project_id = $1', [project.id]),
    store.query<{ academic_year: string; report: string; opinion: string | null; decision: string | null }>('SELECT academic_year, report, opinion, decision FROM unoa.progress_review WHERE project_id = $1 ORDER BY academic_year', [project.id]),
    store.query<{ id: string; kind: string; title: string; hours: number; evidence: string; validated_at: Date | null }>('SELECT id, kind, title, hours, evidence, validated_at FROM unoa.doctoral_training WHERE project_id = $1 ORDER BY created_at', [project.id]),
    store.query<{ kind: string; title: string; venue: string; year: number; status: string; doi: string | null }>('SELECT kind, title, venue, year, status, doi FROM unoa.publication WHERE project_id = $1 ORDER BY year DESC', [project.id]),
    store.query<{ committee: string; reference: string; decision: string; note: string; recorded_at: Date }>('SELECT committee, reference, decision, note, recorded_at FROM unoa.ethics_review WHERE project_id = $1 ORDER BY recorded_at', [project.id]),
    store.query<{ authorized_at: Date; conditions: string }>('SELECT authorized_at, conditions FROM unoa.defense_authorization WHERE project_id = $1', [project.id]),
  ]);
  return { project, meta, ...school.rows[0], enrollments: enrollments.rows, active: await activeEnrollment(store, project.id), committee: committee.rows, reviews: reviews.rows,
    trainings: trainings.rows, publications: publications.rows, ethics: ethics.rows, authorization: authorization.rows[0] ?? null, conditions: await defenseConditions(store, project, meta) };
}

export async function doctoralSpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [labs, applications, projects] = await Promise.all([
    store.query<{ id: string; name: string; school: string; scope_id: string }>(`SELECT lab.id, lab.name, school.name AS school, school.scope_id FROM unoa.doctoral_lab AS lab
      JOIN unoa.doctoral_school AS school ON school.id = lab.school_id ORDER BY school.name, lab.name LIMIT 200`),
    store.query<{ id: string; title: string; state: string; decision_note: string | null; school: string }>(`SELECT application.id, application.title, application.state, application.decision_note,
      school.name AS school FROM unoa.doctoral_application AS application JOIN unoa.doctoral_school AS school ON school.id = application.school_id WHERE application.account_id = $1 ORDER BY submitted_at DESC`, [actor]),
    store.query<{ project_id: string; relation: string }>(`SELECT doctoral.project_id, CASE WHEN project.author_id = $1 THEN 'doctorant' WHEN EXISTS (SELECT 1 FROM unoa.supervision
        WHERE project_id = project.id AND account_id = $1 AND ended_at IS NULL) THEN 'directeur' ELSE 'comité' END AS relation
      FROM unoa.doctoral_project AS doctoral JOIN unoa.thesis_project AS project ON project.id = doctoral.project_id
      WHERE project.author_id = $1 OR EXISTS (SELECT 1 FROM unoa.supervision WHERE project_id = project.id AND account_id = $1 AND ended_at IS NULL)
        OR EXISTS (SELECT 1 FROM unoa.committee_member WHERE project_id = project.id AND account_id = $1)`, [actor]),
  ]);
  const directors = labs.rows.length ? (await store.query<{ id: string; name: string | null }>(`SELECT id, name FROM unoa.scope_people(NULL, 'phd.direct') WHERE id <> $1 ORDER BY name LIMIT 200`, [actor])).rows : [];
  const theses = [];
  for (const item of projects.rows) theses.push({ relation: item.relation, ...(await dossier(store, item.project_id)) });
  return { labs: labs.rows, applications: applications.rows, theses, directors };
}

export async function phdContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature = 'institution' AND unoa.has_scope_permission($1, 'phd.read', scope.id) ORDER BY scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function phdOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const [label, schools, labs, applications, projects, people] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; name: string; director: string | null }>('SELECT school.id, school.name, account.display_name AS director FROM unoa.doctoral_school AS school LEFT JOIN unoa.account ON account.id = school.director_id WHERE school.scope_id = $1 ORDER BY school.name', [scopeId]),
    store.query<{ id: string; school_id: string; code: string; name: string }>('SELECT lab.id, lab.school_id, lab.code, lab.name FROM unoa.doctoral_lab AS lab JOIN unoa.doctoral_school AS school ON school.id = lab.school_id WHERE school.scope_id = $1 ORDER BY lab.name', [scopeId]),
    store.query<{ id: string; title: string; name: string | null; state: string; funding: string | null; funding_status: string; director: string | null; account_id: string; proposed_director_id: string; dossier: string }>(`
      SELECT application.id, application.title, account.display_name AS name, application.state, application.funding, application.funding_status, director.display_name AS director,
        application.account_id, application.proposed_director_id, application.dossier FROM unoa.doctoral_application AS application JOIN unoa.doctoral_school AS school ON school.id = application.school_id
      JOIN unoa.account ON account.id = application.account_id JOIN unoa.account AS director ON director.id = application.proposed_director_id WHERE school.scope_id = $1 ORDER BY application.submitted_at DESC`, [scopeId]),
    store.query<{ project_id: string }>('SELECT doctoral.project_id FROM unoa.doctoral_project AS doctoral JOIN unoa.doctoral_school AS school ON school.id = doctoral.school_id WHERE school.scope_id = $1', [scopeId]),
    store.query<{ id: string; name: string | null }>(`SELECT id, name FROM unoa.scope_people($1, NULL) ORDER BY name LIMIT 300`, [scopeId]),
  ]);
  ensure(label.rows[0], 404, 'Établissement introuvable');
  const theses = [];
  for (const item of projects.rows) theses.push(await dossier(store, item.project_id));
  return { scope: { id: scopeId, label: label.rows[0].label }, rights: granted, schools: schools.rows, labs: labs.rows, applications: applications.rows, theses, people: people.rows };
}
