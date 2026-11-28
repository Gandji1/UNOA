import 'server-only';
import { createHash } from 'node:crypto';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, https, integer, list, numeric, optional, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Theses and defences (module MEM; the doctorate builds on it). Staff act on the
// project's scope; the author works on their project; supervisors comment and
// accept the final version; jury members report, sit and sign.

type Right = 'read' | 'manage' | 'validate' | 'integrity';
export const levelLabels: Record<string, string> = { licence: 'Licence', master: 'Master', doctorat: 'Doctorat' };
export const projectStates: Record<string, string> = { draft: 'Brouillon', submitted: 'Soumis', validated: 'Validé', rejected: 'Refusé', defended: 'Soutenu', archived: 'Déposé et archivé' };
export const outcomeLabels: Record<string, string> = { admitted: 'Admis', admitted_with_corrections: 'Admis avec corrections', adjourned: 'Ajourné', rejected: 'Refusé' };
export const roleLabels: Record<string, string> = { president: 'Président', rapporteur: 'Rapporteur', examiner: 'Examinateur', supervisor: 'Directeur ou codirecteur' };

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`SELECT unoa.has_scope_permission($1, 'thesis.read', $2) AS read, unoa.has_scope_permission($1, 'thesis.manage', $2) AS manage,
    unoa.has_scope_permission($1, 'thesis.validate', $2) AS validate, unoa.has_scope_permission($1, 'thesis.integrity', $2) AS integrity`, [actor, scopeId]);
  return rows[0];
}
async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux responsables des mémoires et thèses');
  return granted;
}
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

export interface ProjectRow { id: string; scope_id: string; level: string; topic_id: string | null; author_id: string; registration_id: string | null; unit_id: string | null;
  title: string; protocol: string | null; confidential: boolean; state: string }
export async function projectOf(store: Queryable, id: unknown, lock = false) {
  const { rows } = await store.query<ProjectRow>(`SELECT id, scope_id, level, topic_id, author_id, registration_id, unit_id, title, protocol, confidential, state
    FROM unoa.thesis_project WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Projet introuvable');
  return rows[0];
}
export async function director(store: Queryable, projectId: string) {
  const { rows } = await store.query<{ account_id: string }>("SELECT account_id FROM unoa.supervision WHERE project_id = $1 AND role = 'director' AND ended_at IS NULL", [projectId]);
  return rows[0]?.account_id ?? null;
}
async function supervisors(store: Queryable, projectId: string) {
  const { rows } = await store.query<{ account_id: string }>('SELECT account_id FROM unoa.supervision WHERE project_id = $1 AND ended_at IS NULL', [projectId]);
  return rows.map(row => row.account_id);
}
export async function ruleOf(store: Queryable, project: ProjectRow) {
  const { rows: [found] } = await store.query<{ id: string | null }>('SELECT unoa.thesis_rule_for($1, $2, current_date) AS id', [project.scope_id, project.level]);
  ensure(found.id, 422, 'Aucun règlement des soutenances n’est défini pour ce niveau');
  const { rows: [rule] } = await store.query<{ id: string; min_jury: number; rapporteurs: number; external_member: boolean; similarity_threshold: number; max_embargo_years: number;
    notice_days: number; max_years: number | null; training_hours: number | null; ethics_required: boolean }>('SELECT * FROM unoa.thesis_rule WHERE id = $1', [found.id]);
  return rule;
}
// Who may read a project's content: author, supervisors, jury, and staff (thesis.read) — never the public (MEM confidentiality).
export async function canRead(store: Queryable, actor: string, project: ProjectRow) {
  if (project.author_id === actor || (await supervisors(store, project.id)).includes(actor)) return true;
  const { rows: [member] } = await store.query('SELECT 1 FROM unoa.defense_member JOIN unoa.defense ON defense.id = defense_member.defense_id WHERE defense.project_id = $1 AND defense_member.account_id = $2', [project.id, actor]);
  if (member) return true;
  return !!(await rights(store, actor, project.scope_id))?.read;
}

// ------------------------------------------------------------ rules, topics

async function setupAction(store: Queryable, actor: string, action: string, input: Input) {
  if (action === 'rules') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'manage');
    const level = choice(input.level, ['licence', 'master', 'doctorat'] as const, 'Niveau');
    await store.query(`INSERT INTO unoa.thesis_rule(scope_id, level, min_jury, rapporteurs, external_member, similarity_threshold, max_embargo_years, notice_days, max_years,
      training_hours, ethics_required, effective_from, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [scopeId, level,
      integer(input.minJury, 'Membres du jury', 1, 12), integer(input.rapporteurs ?? 0, 'Rapporteurs', 0, 4), flag(input.externalMember), integer(input.similarityThreshold, 'Seuil de similarité', 1, 100),
      integer(input.maxEmbargoYears ?? 0, 'Embargo maximal', 0, 10), integer(input.noticeDays ?? 0, 'Délai de convocation', 0, 120),
      optional(input.maxYears, value => integer(value, 'Durée maximale', 1, 12)), optional(input.trainingHours, value => integer(value, 'Heures de formation', 0, 1000)),
      flag(input.ethicsRequired), day(input.effectiveFrom, 'Date d’effet'), actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Un règlement existe déjà à cette date pour ce niveau');
      throw error;
    });
    return { scopeId };
  }
  if (action === 'topics') {
    const scopeId = uuid(input.scopeId);
    const granted = await rights(store, actor, scopeId);
    const { rows: [supervise] } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'thesis.supervise', $2) AS ok", [actor, scopeId]);
    ensure(granted?.manage || supervise.ok, 403, 'Proposition de sujets réservée aux encadrants et responsables');
    const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.thesis_topic(scope_id, level, title, summary, proposed_by) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [scopeId, choice(input.level, ['licence', 'master', 'doctorat'] as const, 'Niveau'), boundedText(input.title, 300, 'Sujet'), boundedText(input.summary, 6000, 'Présentation'), actor]);
    return { scopeId, subject: rows[0].id };
  }
  if (action === 'validate-topic') {
    const { rows: [topic] } = await store.query<{ id: string; scope_id: string; proposed_by: string; state: string }>('SELECT id, scope_id, proposed_by, state FROM unoa.thesis_topic WHERE id = $1 FOR UPDATE', [uuid(input.topicId)]);
    ensure(topic, 404, 'Sujet introuvable');
    await require(store, actor, topic.scope_id, 'validate');
    ensure(topic.state === 'proposed', 409, 'Sujet déjà traité');
    ensure(topic.proposed_by !== actor, 403, 'La validation revient à une autre personne que l’auteur du sujet');
    await store.query("UPDATE unoa.thesis_topic SET state = $2, validated_by = $3 WHERE id = $1", [topic.id, choice(input.decision, ['open', 'closed'] as const, 'Décision'), actor]);
    return { scopeId: topic.scope_id, subject: topic.id };
  }
  throw new Problem(404, 'Opération inconnue');
}

// ------------------------------------------------------------- the project

async function authorAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'projects') {
    const topicId = optional(input.topicId, uuid);
    let scopeId: string; let level: string;
    if (topicId) {
      const { rows: [topic] } = await store.query<{ scope_id: string; level: string; state: string }>('SELECT scope_id, level, state FROM unoa.thesis_topic WHERE id = $1 FOR UPDATE', [topicId]);
      ensure(topic?.state === 'open', 409, 'Sujet non ouvert ou déjà pris');
      scopeId = topic.scope_id; level = topic.level;
      await store.query("UPDATE unoa.thesis_topic SET state = 'taken' WHERE id = $1", [topicId]);
    } else {
      scopeId = uuid(input.scopeId);
      level = choice(input.level, ['licence', 'master', 'doctorat'] as const, 'Niveau');
      ensure((await store.query("SELECT 1 FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE scope.id = $1 AND kind.nature IN ('institution', 'academic_unit')", [scopeId])).rows[0], 422, 'Établissement ou composante requis');
    }
    const registration = optional(input.registrationId, uuid);
    const unit = optional(input.unitId, uuid);
    if (registration) {
      ensure((await store.query("SELECT 1 FROM unoa.registration JOIN unoa.student ON student.id = registration.student_id WHERE registration.id = $1 AND student.account_id = $2 AND registration.state = 'validated'", [registration, actor])).rows[0], 403, 'Inscription d’un autre étudiant');
      if (unit) ensure((await store.query("SELECT 1 FROM unoa.course_registration WHERE registration_id = $1 AND unit_id = $2 AND state <> 'withdrawn'", [registration, unit])).rows[0], 422, 'Unité absente de votre inscription pédagogique');
    } else ensure(!unit, 400, 'Une unité exige l’inscription correspondante');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.thesis_project(scope_id, level, topic_id, author_id, registration_id, unit_id, title, abstract, confidential)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [scopeId, level, topicId, actor, registration, unit, boundedText(input.title, 300, 'Titre'),
      optional(input.abstract, text(6000, 'Résumé')), flag(input.confidential)]);
    await audit(store, actor, scopeId, 'thesis.project_created', correlation, rows[0].id);
    return { projectId: rows[0].id };
  }
  const project = await projectOf(store, input.projectId, true);
  ensure(project.author_id === actor, 403, 'Action réservée à l’auteur');
  if (action === 'protocol') {
    ensure(['draft', 'rejected'].includes(project.state), 409, 'Projet déjà soumis ou validé');
    await store.query("UPDATE unoa.thesis_project SET protocol = $2, abstract = coalesce($3, abstract), state = 'draft' WHERE id = $1",
      [project.id, boundedText(input.protocol, 20000, 'Protocole'), optional(input.abstract, text(6000, 'Résumé'))]);
  } else if (action === 'submit') {
    ensure(project.state === 'draft' && project.protocol, 422, 'Rédigez le protocole avant de soumettre');
    await store.query("UPDATE unoa.thesis_project SET state = 'submitted' WHERE id = $1", [project.id]);
  } else throw new Problem(404, 'Opération inconnue');
  await audit(store, actor, project.scope_id, 'thesis.' + action, correlation, project.id);
  return { projectId: project.id };
}

async function staffAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  const project = await projectOf(store, input.projectId, true);
  const done = { projectId: project.id, scopeId: project.scope_id };
  if (action === 'validate-project') {
    await require(store, actor, project.scope_id, 'validate');
    ensure(project.state === 'submitted', 409, 'Projet non soumis');
    ensure(project.author_id !== actor && !(await supervisors(store, project.id)).includes(actor), 403, 'La validation revient à une personne qui n’encadre pas le projet');
    const decision = choice(input.decision, ['validated', 'rejected'] as const, 'Décision');
    await store.query('UPDATE unoa.thesis_project SET state = $2, validated_by = $3, validation_note = $4 WHERE id = $1', [project.id, decision, actor,
      decision === 'rejected' ? boundedText(input.note, 2000, 'Motif') : optional(input.note, text(2000, 'Observation'))]);
    await dispatch(store, { event: 'thesis.validated', scopeId: project.scope_id, recipients: [project.author_id], correlation,
      values: { title: project.title, decision: decision === 'validated' ? 'validé' : 'à reprendre' }, link: '/memoires/projet?id=' + project.id });
  } else if (action === 'supervise') {
    await require(store, actor, project.scope_id, 'manage');
    const account = uuid(input.accountId);
    // Qualification (MEM-002, PHD-004): the supervising permission in the project's scope; a doctorate needs the authority to direct research.
    const permission = project.level === 'doctorat' ? 'phd.direct' : 'thesis.supervise';
    const { rows: [qualified] } = await store.query<{ ok: boolean }>('SELECT unoa.has_scope_permission($1, $2, $3) AS ok', [account, permission, project.scope_id]);
    ensure(qualified.ok, 422, project.level === 'doctorat' ? 'Direction de thèse réservée aux personnes habilitées à diriger des recherches' : 'Encadrement réservé aux personnes qualifiées');
    await store.query('INSERT INTO unoa.supervision(project_id, account_id, role, qualification, assigned_by) VALUES ($1, $2, $3, $4, $5)',
      [project.id, account, choice(input.role, ['director', 'co_director'] as const, 'Rôle'), boundedText(input.qualification, 300, 'Qualification'), actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Le projet a déjà un directeur ou cette personne l’encadre déjà');
      throw error;
    });
  } else if (action === 'end-supervision') {
    await require(store, actor, project.scope_id, 'manage');
    const { rowCount } = await store.query('UPDATE unoa.supervision SET ended_at = now(), end_reason = $3 WHERE project_id = $1 AND account_id = $2 AND ended_at IS NULL',
      [project.id, uuid(input.accountId), boundedText(input.reason, 500, 'Motif')]);
    ensure(rowCount, 404, 'Encadrement introuvable');
  } else if (action === 'milestones') {
    ensure(await director(store, project.id) === actor || (await rights(store, actor, project.scope_id))?.manage, 403, 'Jalons fixés par le directeur');
    await store.query('INSERT INTO unoa.thesis_milestone(project_id, label, due_on, created_by) VALUES ($1, $2, $3, $4)', [project.id, boundedText(input.label, 200, 'Jalon'), day(input.dueOn, 'Échéance'), actor]);
  } else if (action === 'milestone-done') {
    ensure(project.author_id === actor || (await supervisors(store, project.id)).includes(actor), 403, 'Réservé à l’auteur et aux encadrants');
    const { rowCount } = await store.query('UPDATE unoa.thesis_milestone SET done_at = now() WHERE id = $1 AND project_id = $2 AND done_at IS NULL', [uuid(input.milestoneId), project.id]);
    ensure(rowCount, 409, 'Jalon introuvable ou déjà atteint');
  } else throw new Problem(404, 'Opération inconnue');
  await audit(store, actor, project.scope_id, 'thesis.' + action.replace(/-/g, '_'), correlation, project.id);
  return done;
}

// -------------------------------------------------------- drafts, integrity

export async function uploadDraft(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const file = input.file;
  ensure(file instanceof File, 400, 'Fichier requis');
  const bytes = new Uint8Array(await file.arrayBuffer());
  ensure(file.name.toLowerCase().endsWith('.pdf') && bytes.byteLength > 4 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-', 400, 'Document PDF requis');
  ensure(bytes.byteLength <= 20 * 1024 * 1024, 413, 'Fichier de 20 Mo au plus');
  return transaction(settings, 'unoa.thesis.draft', async store => {
    const project = await projectOf(store, input.projectId, true);
    ensure(project.author_id === actor, 403, 'Dépôt réservé à l’auteur');
    const kind = choice(input.kind ?? 'draft', ['draft', 'final', 'corrected'] as const, 'Nature');
    if (kind === 'draft') {
      ensure(project.state === 'validated', 422, 'Dépôt de brouillon après validation du projet');
      ensure(await director(store, project.id), 422, 'Encadrement interrompu : un directeur doit être désigné');
    } else {
      const { rows: [defense] } = await store.query<{ outcome: string }>("SELECT outcome FROM unoa.defense WHERE project_id = $1 AND state = 'held' ORDER BY held_at DESC LIMIT 1", [project.id]);
      ensure(defense && ['admitted', 'admitted_with_corrections'].includes(defense.outcome), 422, 'Dépôt final après une soutenance favorable');
      ensure(kind === 'corrected' || defense.outcome === 'admitted', 422, 'Les corrections demandées exigent une version corrigée');
    }
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.thesis_draft(project_id, version, kind, filename, format, size_bytes, sha256, content, submitted_by)
      VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM unoa.thesis_draft WHERE project_id = $1), $2, $3, 'pdf', $4, $5, $6, $7) RETURNING id`,
      [project.id, kind, file.name.slice(0, 200), bytes.byteLength, sha(bytes), Buffer.from(bytes), actor]);
    await audit(store, actor, project.scope_id, 'thesis.draft_deposited', correlation, rows[0].id);
    return { projectId: project.id };
  });
}

async function draftAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  const { rows: [draft] } = await store.query<{ id: string; project_id: string; version: number }>('SELECT id, project_id, version FROM unoa.thesis_draft WHERE id = $1', [uuid(input.draftId)]);
  ensure(draft, 404, 'Version introuvable');
  const project = await projectOf(store, draft.project_id);
  if (action === 'comments') {
    const { rows: [member] } = await store.query('SELECT 1 FROM unoa.defense_member JOIN unoa.defense ON defense.id = defense_member.defense_id WHERE defense.project_id = $1 AND defense_member.account_id = $2', [project.id, actor]);
    ensure((await supervisors(store, project.id)).includes(actor) || member, 403, 'Commentaires réservés aux encadrants et au jury');
    await store.query('INSERT INTO unoa.draft_comment(draft_id, author_id, body) VALUES ($1, $2, $3)', [draft.id, actor, boundedText(input.body, 8000, 'Commentaire')]);
    await dispatch(store, { event: 'thesis.comment', scopeId: project.scope_id, recipients: [project.author_id], correlation, values: { title: project.title }, link: '/memoires/projet?id=' + project.id });
  } else if (action === 'integrity') {
    await require(store, actor, project.scope_id, 'integrity');
    const rule = await ruleOf(store, project);
    const method = choice(input.method, ['similarity_report', 'manual_review'] as const, 'Méthode');
    const similarity = method === 'similarity_report' ? integer(input.similarity, 'Taux de similarité', 0, 100) : null;
    // Proportionate: above the rule's threshold the work is suspected; a human review states its own result.
    const result = similarity !== null ? (similarity >= rule.similarity_threshold ? 'suspected' : 'clear') : choice(input.result, ['clear', 'suspected'] as const, 'Résultat');
    await store.query('INSERT INTO unoa.integrity_check(draft_id, method, similarity, result, note, checked_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [draft.id, method, similarity, result, boundedText(input.note, 4000, 'Constat'), actor]);
  } else throw new Problem(404, 'Opération inconnue');
  await audit(store, actor, project.scope_id, 'thesis.' + action, correlation, draft.id);
  return { projectId: project.id };
}

// The latest draft must have a clear integrity check (no defence for a suspected work).
export async function integrityClear(store: Queryable, projectId: string) {
  const { rows: [latest] } = await store.query<{ result: string | null }>(`SELECT (SELECT result FROM unoa.integrity_check WHERE draft_id = draft.id ORDER BY created_at DESC LIMIT 1) AS result
    FROM unoa.thesis_draft AS draft WHERE draft.project_id = $1 AND draft.kind = 'draft' ORDER BY draft.version DESC LIMIT 1`, [projectId]);
  return latest?.result ?? null;
}

// ----------------------------------------------------------------- defence

async function defenseAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'defenses') {
    const project = await projectOf(store, input.projectId, true);
    await require(store, actor, project.scope_id, 'manage');
    ensure(project.state === 'validated', 422, 'Soutenance d’un projet validé');
    const integrity = await integrityClear(store, project.id);
    ensure(integrity, 422, 'Contrôle d’intégrité de la dernière version requis');
    ensure(integrity === 'clear', 422, 'Soutenance impossible : suspicion de plagiat sur la dernière version');
    const rule = await ruleOf(store, project);
    if (project.level === 'doctorat') {
      const { rows: [authorised] } = await store.query('SELECT 1 FROM unoa.defense_authorization WHERE project_id = $1', [project.id]);
      ensure(authorised, 422, 'Soutenance de thèse : autorisation de pré-soutenance requise');
    }
    const mode = choice(input.mode, ['onsite', 'online', 'hybrid'] as const, 'Modalité');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.defense(project_id, rule_id, mode, starts_at, place, meeting_url, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [project.id, rule.id, mode, utcTime(input.startsAt), mode === 'online' ? optional(input.place, text(300, 'Lieu')) : boundedText(input.place, 300, 'Lieu'),
        mode === 'onsite' ? optional(input.meetingUrl, value => https(value, 'Lien de visioconférence')) : https(input.meetingUrl, 'Lien de visioconférence'), actor]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Une soutenance est déjà prévue');
      throw error;
    });
    return { projectId: project.id, scopeId: project.scope_id, defenseId: rows[0].id };
  }
  const { rows: [defense] } = await store.query<{ id: string; project_id: string; rule_id: string; state: string; starts_at: Date; mode: string; place: string | null; meeting_url: string | null }>(
    'SELECT id, project_id, rule_id, state, starts_at, mode, place, meeting_url FROM unoa.defense WHERE id = $1 FOR UPDATE', [uuid(input.defenseId)]);
  ensure(defense, 404, 'Soutenance introuvable');
  const project = await projectOf(store, defense.project_id, true);
  const { rows: [rule] } = await store.query<{ min_jury: number; rapporteurs: number; external_member: boolean; notice_days: number }>('SELECT * FROM unoa.thesis_rule WHERE id = $1', [defense.rule_id]);
  const done = { projectId: project.id, scopeId: project.scope_id };
  const { rows: members } = await store.query<{ account_id: string; role: string; external: boolean; present: boolean | null }>('SELECT account_id, role, external, present FROM unoa.defense_member WHERE defense_id = $1', [defense.id]);
  if (action === 'jury') {
    await require(store, actor, project.scope_id, 'manage');
    ensure(defense.state === 'planned', 409, 'Jury figé après convocation');
    const role = choice(input.role, ['president', 'rapporteur', 'examiner', 'supervisor'] as const, 'Rôle');
    const account = uuid(input.accountId);
    if (role === 'supervisor') ensure((await supervisors(store, project.id)).includes(account), 422, 'Seul un encadrant du projet siège à ce titre');
    await store.query('INSERT INTO unoa.defense_member(defense_id, account_id, role, external) VALUES ($1, $2, $3, $4)', [defense.id, account, role, flag(input.external)]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Déjà membre ou président déjà désigné');
      throw error;
    });
    return done;
  }
  if (action === 'reports') {
    const member = members.find(item => item.account_id === actor);
    ensure(member?.role === 'rapporteur', 403, 'Rapport réservé aux rapporteurs');
    ensure(defense.state === 'planned', 409, 'Rapports avant la convocation');
    await store.query('INSERT INTO unoa.defense_report(defense_id, account_id, opinion, report) VALUES ($1, $2, $3, $4)', [defense.id, actor,
      choice(input.opinion, ['favourable', 'unfavourable'] as const, 'Avis'), boundedText(input.report, 20000, 'Rapport')]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Rapport déjà déposé');
      throw error;
    });
    return done;
  }
  if (action === 'convene') {
    await require(store, actor, project.scope_id, 'manage');
    ensure(defense.state === 'planned', 409, 'Déjà convoquée ou tenue');
    // Composition according to the regulation in force (MEM-007).
    ensure(members.length >= rule.min_jury, 422, `Jury incomplet : ${members.length} membre(s) pour ${rule.min_jury} requis`);
    ensure(members.filter(item => item.role === 'president').length === 1, 422, 'Un président est requis');
    const rapporteurs = members.filter(item => item.role === 'rapporteur');
    ensure(rapporteurs.length >= rule.rapporteurs, 422, `${rule.rapporteurs} rapporteur(s) requis`);
    ensure(!rule.external_member || members.some(item => item.external), 422, 'Un membre extérieur à l’établissement est requis');
    const { rows: reports } = await store.query<{ opinion: string }>('SELECT opinion FROM unoa.defense_report WHERE defense_id = $1', [defense.id]);
    ensure(reports.length >= rapporteurs.length && reports.every(item => item.opinion === 'favourable'), 422, 'Les rapports favorables de tous les rapporteurs précèdent la convocation');
    ensure(defense.starts_at.getTime() - Date.now() >= rule.notice_days * 86_400_000, 422, `Convocation au moins ${rule.notice_days} jour(s) avant la soutenance`);
    await store.query("UPDATE unoa.defense_member SET convened_at = now() WHERE defense_id = $1", [defense.id]);
    await store.query("UPDATE unoa.defense SET state = 'convened' WHERE id = $1", [defense.id]);
    await dispatch(store, { event: 'thesis.convocation', scopeId: project.scope_id, recipients: [project.author_id, ...members.map(item => item.account_id)], correlation,
      values: { title: project.title, date: defense.starts_at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC', mode: defense.mode === 'online' ? 'en ligne' : defense.place ?? '' },
      link: '/memoires/projet?id=' + project.id });
    await audit(store, actor, project.scope_id, 'thesis.convened', correlation, defense.id);
    return done;
  }
  if (action === 'hold') {
    ensure(members.find(item => item.account_id === actor)?.role === 'president', 403, 'Le président du jury établit le procès-verbal');
    ensure(defense.state === 'convened', 422, 'Soutenance sans jury convoqué');
    const present = new Set(list(input.present, 20).map(uuid)); present.add(actor);
    ensure([...present].every(id => members.some(item => item.account_id === id)), 422, 'Seuls les membres du jury sont présents');
    ensure(present.size >= rule.min_jury, 422, `Jury insuffisant : ${present.size} présent(s) pour ${rule.min_jury} requis`);
    const outcome = choice(input.outcome, ['admitted', 'admitted_with_corrections', 'adjourned', 'rejected'] as const, 'Décision');
    const mark = optional(input.mark, numeric);
    ensure(mark === null || mark >= 0, 400, 'Note invalide');
    const names = (await store.query<{ id: string; name: string | null }>('SELECT id, display_name AS name FROM unoa.account WHERE id = ANY($1::uuid[])', [members.map(item => item.account_id)])).rows;
    const minutes = [`Procès-verbal de soutenance — ${project.title}`, `Niveau : ${levelLabels[project.level]} · ${defense.mode === 'online' ? 'en ligne' : defense.place}`,
      `Jury : ${members.map(item => `${names.find(row => row.id === item.account_id)?.name ?? item.account_id} (${roleLabels[item.role]}${present.has(item.account_id) ? ', présent' : ', absent'})`).join(' ; ')}`,
      `Décision : ${outcomeLabels[outcome]}${mark !== null ? ` · note ${mark}` : ''}`, '', optional(input.minutes, text(8000, 'Délibération')) ?? 'Sans observation.'].join('\n');
    await store.query('UPDATE unoa.defense_member SET present = (account_id = ANY($2::uuid[])) WHERE defense_id = $1', [defense.id, [...present]]);
    await store.query("UPDATE unoa.defense SET state = 'held', outcome = $2, mark = $3, minutes = $4, minutes_sha256 = $5, held_at = now() WHERE id = $1", [defense.id, outcome, mark, minutes, sha(minutes)]);
    if (['admitted', 'admitted_with_corrections'].includes(outcome)) {
      await store.query("UPDATE unoa.thesis_project SET state = 'defended' WHERE id = $1", [project.id]);
      // MEM-011: the mark joins the unit's grades as a provisional entry, validated through the grades module.
      if (project.unit_id && project.registration_id && mark !== null) {
        await store.query(`INSERT INTO unoa.grade_entry(registration_id, unit_id, session, mark, absence, state, reason, author_id)
          VALUES ($1, $2, 'first', $3, 'none', 'provisional', 'Note de soutenance', $4)`, [project.registration_id, project.unit_id, mark, actor]).catch(error => {
          if (error?.code === '23514') throw new Problem(422, 'Note incompatible avec la règle de notation de la formation');
          if (error?.code === 'U0409') throw new Problem(409, 'Résultats déjà délibérés : rectification par le jury de notes');
          throw error;
        });
      }
    }
    await dispatch(store, { event: 'thesis.outcome', scopeId: project.scope_id, recipients: [project.author_id], correlation, values: { title: project.title }, link: '/memoires/projet?id=' + project.id });
    await audit(store, actor, project.scope_id, 'thesis.defense_held', correlation, defense.id);
    return done;
  }
  if (action === 'sign') {
    ensure(members.find(item => item.account_id === actor)?.present, 403, 'Signature réservée aux membres présents');
    const { rows: [held] } = await store.query<{ minutes_sha256: string | null }>("SELECT minutes_sha256 FROM unoa.defense WHERE id = $1 AND state = 'held'", [defense.id]);
    ensure(held?.minutes_sha256, 409, 'Procès-verbal non établi');
    await store.query('INSERT INTO unoa.defense_signature(defense_id, account_id, sha256) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [defense.id, actor, held.minutes_sha256]);
    return done;
  }
  if (action === 'cancel') {
    await require(store, actor, project.scope_id, 'manage');
    ensure(['planned', 'convened'].includes(defense.state), 409, 'Soutenance déjà tenue');
    await store.query("UPDATE unoa.defense SET state = 'cancelled' WHERE id = $1", [defense.id]);
    return done;
  }
  throw new Problem(404, 'Opération inconnue');
}

async function acceptDeposit(store: Queryable, actor: string, input: Input, correlation: string) {
  const project = await projectOf(store, input.projectId, true);
  ensure(await director(store, project.id) === actor, 403, 'Le directeur accepte la version définitive');
  ensure(project.state === 'defended', 422, 'Dépôt définitif après une soutenance favorable');
  const { rows: [draft] } = await store.query<{ id: string }>("SELECT id FROM unoa.thesis_draft WHERE project_id = $1 AND kind IN ('final', 'corrected') ORDER BY version DESC LIMIT 1", [project.id]);
  ensure(draft, 422, 'Aucune version définitive déposée');
  const { rows: [unsigned] } = await store.query<{ total: number }>(`SELECT count(*)::int AS total FROM unoa.defense_member AS member JOIN unoa.defense ON defense.id = member.defense_id
    WHERE defense.project_id = $1 AND defense.state = 'held' AND member.present AND NOT EXISTS (SELECT 1 FROM unoa.defense_signature AS signature
      WHERE signature.defense_id = defense.id AND signature.account_id = member.account_id AND signature.sha256 = defense.minutes_sha256)`, [project.id]);
  ensure(unsigned.total === 0, 422, `${unsigned.total} signature(s) manquante(s) au procès-verbal de soutenance`);
  const rule = await ruleOf(store, project);
  const embargo = optional(input.embargoUntil, value => day(value, 'Fin d’embargo'));
  if (embargo) ensure(Date.parse(embargo) <= Date.now() + rule.max_embargo_years * 366 * 86_400_000, 422, `Embargo de ${rule.max_embargo_years} an(s) au plus`);
  await store.query('INSERT INTO unoa.thesis_deposit(project_id, draft_id, accepted_by, embargo_until, embargo_reason) VALUES ($1, $2, $3, $4, $5)',
    [project.id, draft.id, actor, embargo, embargo ? boundedText(input.embargoReason, 1000, 'Motif de l’embargo') : null]);
  await store.query("UPDATE unoa.thesis_project SET state = 'archived' WHERE id = $1", [project.id]);
  await audit(store, actor, project.scope_id, 'thesis.deposit_accepted', correlation, project.id);
  return { projectId: project.id };
}

export async function thesisAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.thesis.' + action, async store => {
    if (['rules', 'topics', 'validate-topic'].includes(action)) {
      const result = await setupAction(store, actor, action, input);
      await audit(store, actor, result.scopeId, 'thesis.' + action.replace(/-/g, '_'), correlation, result.subject ?? null);
      return result;
    }
    if (['projects', 'protocol', 'submit'].includes(action)) return authorAction(store, actor, action, input, correlation);
    if (['validate-project', 'supervise', 'end-supervision', 'milestones', 'milestone-done'].includes(action)) return staffAction(store, actor, action, input, correlation);
    if (action === 'comments' || action === 'integrity') return draftAction(store, actor, action, input, correlation);
    if (['defenses', 'jury', 'reports', 'convene', 'hold', 'sign', 'cancel'].includes(action)) return defenseAction(store, actor, action, input, correlation);
    if (action === 'accept-deposit') return acceptDeposit(store, actor, input, correlation);
    throw new Problem(404, 'Opération inconnue');
  });
}

// ------------------------------------------------------------------- views

export async function projectDetails(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const project = await projectOf(store, id);
  ensure(await canRead(store, actor, project), 403, 'Projet confidentiel ou réservé');
  const granted = await rights(store, actor, project.scope_id);
  const [full, supervision, milestones, drafts, defenses, deposit] = await Promise.all([
    store.query<{ abstract: string | null; validation_note: string | null; author: string | null }>('SELECT project.abstract, project.validation_note, account.display_name AS author FROM unoa.thesis_project AS project JOIN unoa.account ON account.id = project.author_id WHERE project.id = $1', [project.id]),
    store.query<{ account_id: string; name: string | null; role: string; qualification: string; ended_at: Date | null; end_reason: string | null }>(`SELECT supervision.account_id, account.display_name AS name,
      supervision.role, supervision.qualification, supervision.ended_at, supervision.end_reason FROM unoa.supervision JOIN unoa.account ON account.id = supervision.account_id
      WHERE supervision.project_id = $1 ORDER BY supervision.assigned_at`, [project.id]),
    store.query<{ id: string; label: string; due_on: string; done_at: Date | null }>('SELECT id, label, due_on::text, done_at FROM unoa.thesis_milestone WHERE project_id = $1 ORDER BY due_on', [project.id]),
    store.query<{ id: string; version: number; kind: string; filename: string; sha256: string; submitted_at: Date;
      comments: { author: string | null; body: string; at: string }[]; checks: { method: string; similarity: number | null; result: string; note: string; at: string }[] }>(`
      SELECT draft.id, draft.version, draft.kind, draft.filename, draft.sha256, draft.submitted_at,
        coalesce((SELECT jsonb_agg(jsonb_build_object('author', account.display_name, 'body', comment.body, 'at', comment.created_at) ORDER BY comment.created_at)
          FROM unoa.draft_comment AS comment JOIN unoa.account ON account.id = comment.author_id WHERE comment.draft_id = draft.id), '[]') AS comments,
        coalesce((SELECT jsonb_agg(jsonb_build_object('method', method, 'similarity', similarity, 'result', result, 'note', note, 'at', created_at) ORDER BY created_at)
          FROM unoa.integrity_check WHERE draft_id = draft.id), '[]') AS checks
      FROM unoa.thesis_draft AS draft WHERE draft.project_id = $1 ORDER BY draft.version DESC`, [project.id]),
    store.query<{ id: string; mode: string; starts_at: Date; place: string | null; meeting_url: string | null; state: string; outcome: string | null; mark: string | null; minutes: string | null;
      minutes_sha256: string | null; members: { account_id: string; name: string | null; role: string; external: boolean; present: boolean | null; signed: boolean }[];
      reports: { name: string | null; account_id: string; opinion: string; report: string }[] }>(`
      SELECT defense.id, defense.mode, defense.starts_at, defense.place, defense.meeting_url, defense.state, defense.outcome, defense.mark, defense.minutes, defense.minutes_sha256,
        coalesce((SELECT jsonb_agg(jsonb_build_object('account_id', member.account_id, 'name', account.display_name, 'role', member.role, 'external', member.external, 'present', member.present,
          'signed', EXISTS (SELECT 1 FROM unoa.defense_signature AS signature WHERE signature.defense_id = defense.id AND signature.account_id = member.account_id)))
          FROM unoa.defense_member AS member JOIN unoa.account ON account.id = member.account_id WHERE member.defense_id = defense.id), '[]') AS members,
        coalesce((SELECT jsonb_agg(jsonb_build_object('name', account.display_name, 'account_id', report.account_id, 'opinion', report.opinion, 'report', report.report))
          FROM unoa.defense_report AS report JOIN unoa.account ON account.id = report.account_id WHERE report.defense_id = defense.id), '[]') AS reports
      FROM unoa.defense WHERE defense.project_id = $1 ORDER BY defense.created_at DESC`, [project.id]),
    store.query<{ draft_id: string; embargo_until: string | null; embargo_reason: string | null; deposited_at: Date }>('SELECT draft_id, embargo_until::text, embargo_reason, deposited_at FROM unoa.thesis_deposit WHERE project_id = $1', [project.id]),
  ]);
  const { rows: candidates } = granted?.manage ? await store.query<{ id: string; name: string | null }>(`SELECT id, name FROM unoa.scope_people($1, NULL) WHERE id <> $2 ORDER BY name LIMIT 300`, [project.scope_id, project.author_id]) : { rows: [] };
  return { project, ...full.rows[0], rights: granted, own: project.author_id === actor, supervision: supervision.rows, milestones: milestones.rows, drafts: drafts.rows,
    defenses: defenses.rows, deposit: deposit.rows[0] ?? null, candidates, director: supervision.rows.find(item => item.role === 'director' && !item.ended_at)?.account_id ?? null };
}

export async function draftFile(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows: [draft] } = await store.query<{ project_id: string; filename: string; content: Buffer }>('SELECT project_id, filename, content FROM unoa.thesis_draft WHERE id = $1', [uuid(id)]);
  ensure(draft, 404, 'Version introuvable');
  const project = await projectOf(store, draft.project_id);
  if (!(await canRead(store, actor, project))) {
    // Public archive: the accepted final version only, after the embargo and if not confidential.
    const { rows: [open] } = await store.query(`SELECT 1 FROM unoa.thesis_deposit WHERE project_id = $1 AND draft_id = $2 AND (embargo_until IS NULL OR embargo_until <= current_date)`, [project.id, uuid(id)]);
    ensure(open && !project.confidential, 403, 'Document confidentiel, sous embargo ou réservé');
  }
  return draft;
}

export async function mySpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [projects, topics, registrations] = await Promise.all([
    store.query<{ id: string; title: string; level: string; state: string; relation: string }>(`
      SELECT project.id, project.title, project.level, project.state, 'author' AS relation FROM unoa.thesis_project AS project WHERE project.author_id = $1
      UNION SELECT project.id, project.title, project.level, project.state, 'supervisor' FROM unoa.thesis_project AS project JOIN unoa.supervision ON supervision.project_id = project.id
        WHERE supervision.account_id = $1 AND supervision.ended_at IS NULL
      UNION SELECT project.id, project.title, project.level, project.state, 'jury' FROM unoa.thesis_project AS project JOIN unoa.defense ON defense.project_id = project.id
        JOIN unoa.defense_member AS member ON member.defense_id = defense.id WHERE member.account_id = $1`, [actor]),
    store.query<{ id: string; title: string; summary: string; level: string; scope: string }>(`SELECT topic.id, topic.title, topic.summary, topic.level, scope.label AS scope FROM unoa.thesis_topic AS topic
      JOIN unoa.scope ON scope.id = topic.scope_id WHERE topic.state = 'open' ORDER BY topic.created_at DESC LIMIT 100`),
    store.query<{ id: string; label: string; scope_id: string; units: { id: string; title: string }[] }>(`SELECT registration.id, cohort.label || ' · ' || registration.academic_year AS label, cohort.owner_scope_id AS scope_id,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', unit.id, 'title', unit.code || ' — ' || unit.title)) FROM unoa.course_registration AS course JOIN unoa.teaching_unit AS unit ON unit.id = course.unit_id
        WHERE course.registration_id = registration.id AND course.state <> 'withdrawn'), '[]') AS units
      FROM unoa.registration JOIN unoa.student ON student.id = registration.student_id JOIN unoa.cohort ON cohort.id = registration.cohort_id
      WHERE student.account_id = $1 AND registration.state = 'validated'`, [actor]),
  ]);
  return { projects: projects.rows, topics: topics.rows, registrations: registrations.rows };
}

export async function thesisContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('institution', 'academic_unit') AND unoa.has_scope_permission($1, 'thesis.read', scope.id) ORDER BY kind.nature, scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function thesisOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const [label, rules, topics, projects] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; level: string; min_jury: number; rapporteurs: number; external_member: boolean; similarity_threshold: number; max_embargo_years: number; notice_days: number;
      max_years: number | null; training_hours: number | null; ethics_required: boolean; effective_from: string; scope: string }>(`
      WITH RECURSIVE up AS (SELECT id, parent_id FROM unoa.scope WHERE id = $1 UNION ALL SELECT scope.id, scope.parent_id FROM unoa.scope JOIN up ON scope.id = up.parent_id)
      SELECT rule.*, rule.effective_from::text, scope.label AS scope FROM unoa.thesis_rule AS rule JOIN unoa.scope ON scope.id = rule.scope_id
      WHERE rule.scope_id IN (SELECT id FROM up) OR unoa.scope_within(rule.scope_id, $1) ORDER BY rule.level, rule.effective_from DESC`, [scopeId]),
    store.query<{ id: string; title: string; level: string; state: string; proposed_by: string; name: string | null }>(`SELECT topic.id, topic.title, topic.level, topic.state, topic.proposed_by,
      account.display_name AS name FROM unoa.thesis_topic AS topic JOIN unoa.account ON account.id = topic.proposed_by WHERE unoa.scope_within(topic.scope_id, $1) ORDER BY topic.created_at DESC LIMIT 200`, [scopeId]),
    store.query<{ id: string; title: string; level: string; state: string; author: string | null; director: string | null; confidential: boolean }>(`SELECT project.id, project.title, project.level,
      project.state, account.display_name AS author, project.confidential,
      (SELECT supervisor.display_name FROM unoa.supervision JOIN unoa.account AS supervisor ON supervisor.id = supervision.account_id
        WHERE supervision.project_id = project.id AND supervision.role = 'director' AND supervision.ended_at IS NULL) AS director
      FROM unoa.thesis_project AS project JOIN unoa.account ON account.id = project.author_id WHERE unoa.scope_within(project.scope_id, $1) ORDER BY project.created_at DESC LIMIT 300`, [scopeId]),
  ]);
  ensure(label.rows[0], 404, 'Portée introuvable');
  return { scope: { id: scopeId, label: label.rows[0].label }, rights: granted, rules: rules.rows, topics: topics.rows, projects: projects.rows };
}

// Public archive: metadata of accepted deposits; content only after embargo and if not confidential.
export async function publicArchive(settings: IamSettings) {
  const { rows } = await database(settings).query<{ id: string; title: string; level: string; author: string | null; institution: string; deposited_at: Date; embargo_until: string | null;
    draft_id: string; open: boolean }>(`SELECT project.id, project.title, project.level, account.display_name AS author, scope.label AS institution, deposit.deposited_at, deposit.embargo_until::text,
      deposit.draft_id, (deposit.embargo_until IS NULL OR deposit.embargo_until <= current_date) AS open
    FROM unoa.thesis_deposit AS deposit JOIN unoa.thesis_project AS project ON project.id = deposit.project_id JOIN unoa.account ON account.id = project.author_id
    JOIN unoa.scope ON scope.id = project.scope_id WHERE NOT project.confidential ORDER BY deposit.deposited_at DESC LIMIT 200`);
  return rows;
}
