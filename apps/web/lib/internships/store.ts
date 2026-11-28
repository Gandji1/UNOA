import 'server-only';
import { createHash } from 'node:crypto';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, integer, numeric, optional, Problem, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';
import { memberRole } from '@/lib/companies/store';

// Academic internships (module STG). The student requests; staff of the
// academic scope decide, appoint the academic supervisor and issue the
// agreement from an approved template; the company appoints its tutor; three
// parties sign the same sealed text; logs, messages, report and two reviews
// follow; credits and mark only after the academic validation.

export const internshipStates: Record<string, string> = { requested: 'Demandé', approved: 'Accepté', rejected: 'Refusé', signing: 'Convention à signer', active: 'En cours',
  report: 'Rapport déposé', evaluated: 'Évalué', validated: 'Validé', broken: 'Rompu', cancelled: 'Annulé' };
export const eventLabels: Record<string, string> = { break: 'Rupture', extend: 'Prolongation', postpone: 'Report', dispute: 'Litige', resolve: 'Litige résolu',
  tutor_absent: 'Maître de stage absent', student_absent: 'Absence du stagiaire' };
export const partyLabels: Record<string, string> = { student: 'Stagiaire', company: 'Entreprise', institution: 'Établissement' };

type Right = 'read' | 'manage' | 'sign' | 'validate';
async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`SELECT unoa.has_scope_permission($1, 'stg.read', $2) AS read, unoa.has_scope_permission($1, 'stg.manage', $2) AS manage,
    unoa.has_scope_permission($1, 'stg.sign', $2) AS sign, unoa.has_scope_permission($1, 'stg.validate', $2) AS validate`, [actor, scopeId]);
  return rows[0];
}
async function requireRight(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action réservée aux responsables des stages');
  return granted;
}
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

interface InternshipRow { id: string; scope_id: string; student_id: string; registration_id: string | null; unit_id: string | null; free_training: string | null; company_id: string;
  title: string; missions: string; place: string | null; starts_on: string; ends_on: string; weekly_hours: number; state: string; template_id: string | null; grid_id: string | null;
  agreement: string | null; agreement_sha256: string | null }
async function internshipOf(store: Queryable, id: unknown, lock = false) {
  const { rows } = await store.query<InternshipRow>(`SELECT id, scope_id, student_id, registration_id, unit_id, free_training, company_id, title, missions, place, starts_on::text, ends_on::text,
    weekly_hours, state, template_id, grid_id, agreement, agreement_sha256 FROM unoa.internship WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Stage introuvable');
  return rows[0];
}
async function supervisor(store: Queryable, internshipId: string, role: 'company' | 'academic') {
  const { rows } = await store.query<{ account_id: string }>('SELECT account_id FROM unoa.internship_supervisor WHERE internship_id = $1 AND role = $2 AND ended_at IS NULL', [internshipId, role]);
  return rows[0]?.account_id ?? null;
}

// The actor's relation to an internship; null means no access at all.
type Relation = 'student' | 'tutor' | 'academic' | 'company' | 'staff';
async function relationOf(store: Queryable, actor: string, item: InternshipRow): Promise<Relation | null> {
  if (item.student_id === actor) return 'student';
  if (await supervisor(store, item.id, 'company') === actor) return 'tutor';
  if (await supervisor(store, item.id, 'academic') === actor) return 'academic';
  const role = await memberRole(store, actor, item.company_id);
  if (role === 'owner' || role === 'recruiter') return 'company';
  if ((await rights(store, actor, item.scope_id))?.read) return 'staff';
  return null;
}
async function requireRelation(store: Queryable, actor: string, item: InternshipRow, allowed: Relation[]) {
  const relation = await relationOf(store, actor, item);
  ensure(relation && allowed.includes(relation), 403, 'Action réservée aux parties du stage');
  return relation;
}
async function parties(store: Queryable, item: InternshipRow) {
  const { rows } = await store.query<{ account_id: string }>(`SELECT account_id FROM unoa.internship_supervisor WHERE internship_id = $1 AND ended_at IS NULL
    UNION SELECT account_id FROM unoa.company_member WHERE company_id = $2 AND role IN ('owner', 'recruiter') AND removed_at IS NULL`, [item.id, item.company_id]);
  return [item.student_id, ...rows.map(row => row.account_id)];
}
async function event(store: Queryable, item: InternshipRow, actor: string, kind: string, reason: string, start: string | null = null, end: string | null = null) {
  await store.query('INSERT INTO unoa.internship_event(internship_id, kind, reason, new_start, new_end, actor_id) VALUES ($1, $2, $3, $4, $5, $6)', [item.id, kind, reason, start, end, actor]);
}

function criteriaOf(input: unknown) {
  const lines = String(boundedText(input, 4000, 'Critères')).split('\n').map(line => line.trim()).filter(Boolean);
  ensure(lines.length >= 1 && lines.length <= 20, 400, 'Entre 1 et 20 critères');
  return lines.map(line => {
    const match = /^(.{2,200}?)\s*=\s*(\d+(?:[.,]\d+)?)$/.exec(line);
    ensure(match, 400, 'Critère attendu sous la forme « Intitulé = poids »');
    const weight = Number(match[2].replace(',', '.'));
    ensure(weight > 0 && weight <= 100, 400, 'Poids entre 0 et 100');
    return { label: match[1].trim(), weight };
  });
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => values[key] ?? all);

// ------------------------------------------------------------------- actions

export async function internshipAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.internship.' + action, async store => {
    if (action === 'request') return request(store, actor, input, correlation);
    if (action === 'templates') {
      const scopeId = uuid(input.scopeId);
      await requireRight(store, actor, scopeId, 'manage');
      const body = boundedText(input.body, 40000, 'Texte du modèle');
      ensure(body.trim().length >= 50, 400, 'Texte du modèle trop court');
      const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.internship_template(scope_id, title, body, legal_reference, author_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [scopeId, boundedText(input.title, 200, 'Intitulé'), body, boundedText(input.legalReference, 1000, 'Référence juridique'), actor]);
      await audit(store, actor, scopeId, 'stg.template_created', correlation, rows[0].id);
      return { templateId: rows[0].id, scopeId };
    }
    if (action === 'approve-template' || action === 'retire-template') {
      const { rows: [template] } = await store.query<{ id: string; scope_id: string; author_id: string; approved_at: Date | null; retired_at: Date | null }>(
        'SELECT id, scope_id, author_id, approved_at, retired_at FROM unoa.internship_template WHERE id = $1 FOR UPDATE', [uuid(input.templateId)]);
      ensure(template, 404, 'Modèle introuvable');
      ensure(!template.retired_at, 409, 'Modèle retiré');
      if (action === 'approve-template') {
        await requireRight(store, actor, template.scope_id, 'sign');
        ensure(template.author_id !== actor, 403, 'Le modèle est approuvé par une autre personne que son auteur');
        ensure(!template.approved_at, 409, 'Modèle déjà approuvé');
        await store.query('UPDATE unoa.internship_template SET approved_by = $2, approved_at = now() WHERE id = $1', [template.id, actor]);
      } else {
        await requireRight(store, actor, template.scope_id, 'manage');
        await store.query('UPDATE unoa.internship_template SET retired_at = now() WHERE id = $1', [template.id]);
      }
      await audit(store, actor, template.scope_id, 'stg.' + action.replace('-', '_'), correlation, template.id);
      return { scopeId: template.scope_id };
    }
    if (action === 'grids') {
      const scopeId = uuid(input.scopeId);
      await requireRight(store, actor, scopeId, 'manage');
      const criteria = criteriaOf(input.criteria);
      const scale = numeric(input.scale ?? 20);
      ensure(scale > 0 && scale <= 1000, 400, 'Barème invalide');
      const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.internship_grid(scope_id, title, criteria, scale, author_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [scopeId, boundedText(input.title, 200, 'Intitulé'), JSON.stringify(criteria), scale, actor]);
      return { gridId: rows[0].id, scopeId };
    }

    const item = await internshipOf(store, input.internshipId, true);
    if (action === 'cancel') {
      await requireRelation(store, actor, item, ['student']);
      ensure(['requested', 'approved'].includes(item.state), 409, 'Annulation avant la convention');
      await store.query("UPDATE unoa.internship SET state = 'cancelled' WHERE id = $1", [item.id]);
      return { internshipId: item.id };
    }
    if (action === 'decide') {
      await requireRight(store, actor, item.scope_id, 'manage');
      ensure(item.student_id !== actor, 403, 'Un stagiaire ne décide pas de sa propre demande');
      ensure(item.state === 'requested', 409, 'Demande déjà traitée');
      const decision = choice(input.decision, ['approved', 'rejected'] as const, 'Décision');
      const note = optional(input.note, text(2000, 'Observation'));
      ensure(decision === 'approved' || note, 400, 'Motivez le refus');
      if (decision === 'approved') await eligible(store, item);
      await store.query('UPDATE unoa.internship SET state = $2, decision_note = $3, decided_by = $4 WHERE id = $1', [item.id, decision, note, actor]);
      await dispatch(store, { event: 'stg.decided', scopeId: item.scope_id, recipients: [item.student_id], correlation,
        values: { title: item.title, decision: decision === 'approved' ? 'accepté' : 'refusé' }, link: '/stages?id=' + item.id });
      await audit(store, actor, item.scope_id, 'stg.request_' + decision, correlation, item.id);
      return { internshipId: item.id };
    }
    if (action === 'supervisors') {
      const role = choice(input.role, ['company', 'academic'] as const, 'Rôle');
      ensure(['approved', 'signing', 'active', 'report'].includes(item.state), 409, 'Encadrement d’un stage accepté et non terminé');
      const accountId = uuid(input.accountId);
      ensure(accountId !== item.student_id, 422, 'Le stagiaire ne s’encadre pas lui-même');
      if (role === 'company') {
        const staff = (await rights(store, actor, item.scope_id))?.manage;
        const own = await memberRole(store, actor, item.company_id);
        ensure(staff || own === 'owner' || own === 'recruiter', 403, 'Le maître de stage est désigné par l’entreprise');
        ensure(await memberRole(store, accountId, item.company_id), 422, 'Le maître de stage fait partie de l’équipe de l’entreprise');
      } else {
        await requireRight(store, actor, item.scope_id, 'manage');
        const { rows } = await store.query('SELECT 1 FROM unoa.scope_people($1, NULL) WHERE id = $2', [item.scope_id, accountId]);
        ensure(rows[0], 422, 'L’encadreur académique appartient à l’établissement');
      }
      await store.query("UPDATE unoa.internship_supervisor SET ended_at = now(), end_reason = 'Remplacement' WHERE internship_id = $1 AND role = $2 AND ended_at IS NULL", [item.id, role]);
      await store.query('INSERT INTO unoa.internship_supervisor(internship_id, account_id, role, assigned_by) VALUES ($1, $2, $3, $4)', [item.id, accountId, role, actor]);
      await audit(store, actor, item.scope_id, 'stg.supervisor_' + role, correlation, item.id);
      return { internshipId: item.id };
    }
    if (action === 'agreement') {
      await requireRight(store, actor, item.scope_id, 'manage');
      ensure(item.state === 'approved', 409, 'Convention établie après acceptation de la demande');
      const { rows: [template] } = await store.query<{ id: string; body: string; legal_reference: string }>(`SELECT id, body, legal_reference FROM unoa.internship_template
        WHERE id = $1 AND approved_at IS NOT NULL AND retired_at IS NULL AND unoa.scope_within($2, scope_id)`, [uuid(input.templateId), item.scope_id]);
      ensure(template, 422, 'Modèle de convention approuvé et en vigueur requis');
      const { rows: [grid] } = await store.query<{ id: string }>('SELECT id FROM unoa.internship_grid WHERE id = $1 AND unoa.scope_within($2, scope_id)', [uuid(input.gridId), item.scope_id]);
      ensure(grid, 422, 'Grille d’évaluation du périmètre requise');
      const tutor = await supervisor(store, item.id, 'company'); const academic = await supervisor(store, item.id, 'academic');
      ensure(tutor && academic, 422, 'Désignez le maître de stage et l’encadreur académique avant la convention');
      const { rows: [names] } = await store.query<Record<string, string>>(`SELECT student.display_name AS etudiant, company.name AS entreprise, company.representative_name AS representant,
        tutor.display_name AS maitre_de_stage, academic.display_name AS encadreur, scope.label AS etablissement
        FROM unoa.account AS student, unoa.company, unoa.account AS tutor, unoa.account AS academic, unoa.scope
        WHERE student.id = $1 AND company.id = $2 AND tutor.id = $3 AND academic.id = $4 AND scope.id = $5`, [item.student_id, item.company_id, tutor, academic, item.scope_id]);
      const { rows: [training] } = item.unit_id
        ? await store.query<{ label: string }>("SELECT code || ' — ' || title AS label FROM unoa.teaching_unit WHERE id = $1", [item.unit_id])
        : { rows: [{ label: item.free_training ?? '' }] };
      const agreement = [fill(template.body, { ...names, titre: item.title, missions: item.missions, lieu: item.place ?? '', debut: item.starts_on, fin: item.ends_on,
        heures: String(item.weekly_hours), formation: training?.label ?? '' }), '', 'Référence juridique : ' + template.legal_reference].join('\n');
      await store.query("UPDATE unoa.internship SET state = 'signing', template_id = $2, grid_id = $3, agreement = $4, agreement_sha256 = $5 WHERE id = $1",
        [item.id, template.id, grid.id, agreement, sha(agreement)]);
      await dispatch(store, { event: 'stg.to_sign', scopeId: item.scope_id, recipients: (await parties(store, item)).filter(id => id !== actor), correlation,
        values: { title: item.title }, link: '/stages?id=' + item.id });
      await audit(store, actor, item.scope_id, 'stg.agreement_issued', correlation, item.id);
      return { internshipId: item.id };
    }
    if (action === 'sign') {
      ensure(item.state === 'signing' && item.agreement_sha256, 409, 'Aucune convention à signer');
      ensure(input.sha256 === item.agreement_sha256, 409, 'La convention a changé : relisez-la avant de signer');
      const relation = await relationOf(store, actor, item);
      const party = relation === 'student' ? 'student' : relation === 'company' ? 'company'
        : (relation !== null && relation !== 'tutor' && (await rights(store, actor, item.scope_id))?.sign) ? 'institution' : null;
      ensure(party, 403, 'Signature réservée au stagiaire, au responsable de l’entreprise et à l’établissement');
      await store.query('INSERT INTO unoa.internship_signature(internship_id, party, account_id, sha256) VALUES ($1, $2, $3, $4)', [item.id, party, actor, item.agreement_sha256]).catch(error => {
        if (error?.code === '23505') throw new Problem(409, 'Cette partie a déjà signé');
        throw error;
      });
      const { rows: [count] } = await store.query<{ total: number }>('SELECT count(*)::int AS total FROM unoa.internship_signature WHERE internship_id = $1', [item.id]);
      if (count.total === 3) await store.query("UPDATE unoa.internship SET state = 'active' WHERE id = $1", [item.id]);
      await audit(store, actor, item.scope_id, 'stg.agreement_signed', correlation, item.id);
      return { internshipId: item.id };
    }
    if (action === 'log') {
      const relation = await requireRelation(store, actor, item, ['student', 'tutor', 'academic']);
      ensure(['active', 'report'].includes(item.state), 409, 'Journal ouvert pendant le stage');
      ensure(await supervisor(store, item.id, 'company'), 422, 'Maître de stage absent : l’entreprise doit en désigner un nouveau');
      const kind = choice(input.kind ?? 'log', ['log', 'milestone', 'absence'] as const, 'Nature');
      ensure(kind !== 'absence' || relation !== 'student', 403, 'L’absence est signalée par un encadrant');
      await store.query('INSERT INTO unoa.internship_log(internship_id, author_id, kind, entry_on, body) VALUES ($1, $2, $3, $4, $5)',
        [item.id, actor, kind, day(input.entryOn, 'Date'), boundedText(input.body, 8000, 'Contenu')]);
      if (kind === 'absence') await event(store, item, actor, 'student_absent', boundedText(input.body, 2000, 'Contenu'));
      return { internshipId: item.id };
    }
    if (action === 'message') {
      await requireRelation(store, actor, item, ['student', 'tutor', 'academic', 'company', 'staff']);
      ensure(!['requested', 'rejected', 'cancelled'].includes(item.state), 409, 'Échanges ouverts après acceptation');
      await store.query('INSERT INTO unoa.internship_message(internship_id, author_id, body) VALUES ($1, $2, $3)', [item.id, actor, boundedText(input.body, 8000, 'Message')]);
      return { internshipId: item.id };
    }
    if (action === 'review') {
      const relation = await requireRelation(store, actor, item, ['tutor', 'academic']);
      ensure(item.state === 'report', 409, 'Évaluation après le dépôt du rapport');
      const { rows: [grid] } = await store.query<{ id: string; criteria: { label: string; weight: number }[]; scale: string }>('SELECT id, criteria, scale FROM unoa.internship_grid WHERE id = $1', [item.grid_id]);
      ensure(grid, 422, 'Grille absente');
      const scale = Number(grid.scale);
      const scores = grid.criteria.map((criterion, index) => {
        const value = numeric(input['score' + index]);
        ensure(value >= 0 && value <= scale, 400, `Note de « ${criterion.label} » entre 0 et ${scale}`);
        return { label: criterion.label, weight: criterion.weight, score: value };
      });
      const total = scores.reduce((sum, item) => sum + item.weight, 0);
      const mark = Math.round(scores.reduce((sum, item) => sum + item.score * item.weight, 0) / total * 100) / 100;
      const role = relation === 'tutor' ? 'company' : 'academic';
      await store.query('INSERT INTO unoa.internship_review(internship_id, reviewer_id, role, grid_id, scores, mark, comment) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [item.id, actor, role, grid.id, JSON.stringify(scores), mark, optional(input.comment, text(4000, 'Appréciation'))]).catch(error => {
        if (error?.code === '23505') throw new Problem(409, 'Évaluation déjà enregistrée pour cette partie');
        throw error;
      });
      const { rows: [count] } = await store.query<{ total: number }>('SELECT count(*)::int AS total FROM unoa.internship_review WHERE internship_id = $1', [item.id]);
      if (count.total === 2) await store.query("UPDATE unoa.internship SET state = 'evaluated' WHERE id = $1", [item.id]);
      return { internshipId: item.id, mark };
    }
    if (action === 'validate') {
      await requireRight(store, actor, item.scope_id, 'validate');
      ensure(item.student_id !== actor, 403, 'Validation par une autre personne que le stagiaire');
      ensure(item.state === 'evaluated', 422, 'Validation après le rapport et les deux évaluations');
      const { rows: [average] } = await store.query<{ mark: string }>('SELECT round(avg(mark), 2) AS mark FROM unoa.internship_review WHERE internship_id = $1', [item.id]);
      const mark = optional(input.mark, numeric) ?? Number(average.mark);
      ensure(mark >= 0, 400, 'Note invalide');
      await store.query("UPDATE unoa.internship SET state = 'validated', mark = $2, validated_by = $3, validated_at = now() WHERE id = $1", [item.id, mark, actor]);
      // STG-010: the mark joins the unit's grades as a provisional entry, validated by the grades jury.
      if (item.unit_id && item.registration_id) {
        await store.query(`INSERT INTO unoa.grade_entry(registration_id, unit_id, session, mark, absence, state, reason, author_id)
          VALUES ($1, $2, 'first', $3, 'none', 'provisional', 'Note de stage', $4)`, [item.registration_id, item.unit_id, mark, actor]).catch(error => {
          if (error?.code === '23514') throw new Problem(422, 'Note incompatible avec la règle de notation de la formation');
          if (error?.code === 'U0409') throw new Problem(409, 'Résultats déjà délibérés : rectification par le jury de notes');
          throw error;
        });
      }
      await dispatch(store, { event: 'stg.validated', scopeId: item.scope_id, recipients: [item.student_id], correlation, values: { title: item.title }, link: '/stages?id=' + item.id });
      await audit(store, actor, item.scope_id, 'stg.validated', correlation, item.id);
      return { internshipId: item.id };
    }
    if (action === 'event') {
      const kind = choice(input.kind, ['break', 'extend', 'postpone', 'dispute', 'resolve', 'tutor_absent'] as const, 'Événement');
      const reason = boundedText(input.reason, 2000, 'Motif');
      if (kind === 'dispute') await requireRelation(store, actor, item, ['student', 'tutor', 'academic', 'company', 'staff']);
      else if (kind === 'tutor_absent') await requireRelation(store, actor, item, ['student', 'academic', 'company', 'staff']);
      else await requireRight(store, actor, item.scope_id, 'manage');
      if (kind === 'break') {
        ensure(['signing', 'active', 'report'].includes(item.state), 409, 'Rupture d’une convention en cours');
        await store.query("UPDATE unoa.internship SET state = 'broken' WHERE id = $1", [item.id]);
        await store.query("UPDATE unoa.internship_supervisor SET ended_at = now(), end_reason = 'Rupture de la convention' WHERE internship_id = $1 AND ended_at IS NULL", [item.id]);
      } else if (kind === 'extend') {
        ensure(['active', 'report'].includes(item.state), 409, 'Prolongation d’un stage en cours');
        const end = day(input.newEnd, 'Nouvelle fin');
        ensure(end > item.ends_on, 422, 'La prolongation repousse la fin');
        await store.query('UPDATE unoa.internship SET ends_on = $2 WHERE id = $1', [item.id, end]);
        await event(store, item, actor, kind, reason, null, end);
        return { internshipId: item.id };
      } else if (kind === 'postpone') {
        ensure(['requested', 'approved'].includes(item.state), 409, 'Report avant l’établissement de la convention');
        const start = day(input.newStart, 'Nouveau début'); const end = day(input.newEnd, 'Nouvelle fin');
        ensure(end > start, 400, 'La fin suit le début');
        await store.query('UPDATE unoa.internship SET starts_on = $2, ends_on = $3 WHERE id = $1', [item.id, start, end]);
        await event(store, item, actor, kind, reason, start, end);
        return { internshipId: item.id };
      } else if (kind === 'tutor_absent') {
        ensure(['signing', 'active', 'report'].includes(item.state), 409, 'Stage non en cours');
        await store.query("UPDATE unoa.internship_supervisor SET ended_at = now(), end_reason = $2 WHERE internship_id = $1 AND role = 'company' AND ended_at IS NULL", [item.id, reason.slice(0, 1000)]);
      } else if (kind === 'resolve') {
        const { rows: [open] } = await store.query<{ total: number }>(`SELECT (count(*) FILTER (WHERE kind = 'dispute') - count(*) FILTER (WHERE kind = 'resolve'))::int AS total
          FROM unoa.internship_event WHERE internship_id = $1`, [item.id]);
        ensure(open.total > 0, 409, 'Aucun litige ouvert');
      }
      await event(store, item, actor, kind, reason);
      await audit(store, actor, item.scope_id, 'stg.event_' + kind, correlation, item.id);
      return { internshipId: item.id };
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

// STG-002: placement prerequisites checked at the decision.
async function eligible(store: Queryable, item: InternshipRow) {
  const { rows: [company] } = await store.query<{ state: string }>('SELECT state FROM unoa.company WHERE id = $1', [item.company_id]);
  ensure(company?.state === 'approved', 422, 'Entreprise non approuvée');
  if (item.registration_id) {
    const { rows } = await store.query("SELECT 1 FROM unoa.registration WHERE id = $1 AND state = 'validated'", [item.registration_id]);
    ensure(rows[0], 422, 'Inscription administrative non validée');
  }
  if (item.unit_id) {
    const { rows } = await store.query("SELECT 1 FROM unoa.course_registration WHERE registration_id = $1 AND unit_id = $2 AND state <> 'withdrawn'", [item.registration_id, item.unit_id]);
    ensure(rows[0], 422, 'Unité de stage absente de l’inscription pédagogique');
  }
}

async function request(store: Queryable, actor: string, input: Input, correlation: string) {
  const companyId = uuid(input.companyId);
  const { rows: [company] } = await store.query<{ id: string; scope_id: string; state: string }>('SELECT id, scope_id, state FROM unoa.company WHERE id = $1', [companyId]);
  ensure(company, 404, 'Entreprise introuvable');
  ensure(company.state === 'approved', 422, 'Stage dans une entreprise approuvée par l’établissement');
  const registrationId = optional(input.registrationId, uuid);
  const unitId = optional(input.unitId, uuid);
  let scopeId = company.scope_id;
  let free: string | null = null;
  if (registrationId) {
    const { rows: [registration] } = await store.query<{ scope_id: string }>(`SELECT cohort.owner_scope_id AS scope_id FROM unoa.registration JOIN unoa.student ON student.id = registration.student_id
      JOIN unoa.cohort ON cohort.id = registration.cohort_id WHERE registration.id = $1 AND student.account_id = $2 AND registration.state = 'validated'`, [registrationId, actor]);
    ensure(registration, 403, 'Stage rattaché à votre propre inscription validée');
    scopeId = registration.scope_id;
    if (unitId) ensure((await store.query("SELECT 1 FROM unoa.course_registration WHERE registration_id = $1 AND unit_id = $2 AND state <> 'withdrawn'", [registrationId, unitId])).rows[0],
      422, 'Unité absente de votre inscription pédagogique');
  } else {
    ensure(!unitId, 400, 'Une unité suppose une inscription');
    free = boundedText(input.freeTraining, 300, 'Formation suivie').trim();
    const { rows } = await store.query('SELECT 1 FROM unoa.student WHERE account_id = $1 UNION SELECT 1 FROM unoa.short_enrollment WHERE account_id = $1', [actor]);
    ensure(rows[0], 403, 'Demande réservée aux étudiants et apprenants inscrits');
  }
  const startsOn = day(input.startsOn, 'Début'); const endsOn = day(input.endsOn, 'Fin');
  ensure(endsOn > startsOn, 400, 'La fin suit le début');
  const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.internship(scope_id, student_id, registration_id, unit_id, free_training, company_id, title, missions, place, starts_on, ends_on, weekly_hours)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`, [scopeId, actor, registrationId, unitId, free, company.id, boundedText(input.title, 300, 'Intitulé'),
    boundedText(input.missions, 8000, 'Missions'), optional(input.place, text(300, 'Lieu')), startsOn, endsOn, integer(input.weeklyHours, 'Heures par semaine', 1, 60)]);
  await audit(store, actor, scopeId, 'stg.requested', correlation, rows[0].id);
  return { internshipId: rows[0].id };
}

export async function uploadReport(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const file = input.file;
  ensure(file instanceof File, 400, 'Fichier requis');
  const bytes = new Uint8Array(await file.arrayBuffer());
  ensure(file.name.toLowerCase().endsWith('.pdf') && bytes.byteLength > 4 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-', 400, 'Rapport au format PDF');
  ensure(bytes.byteLength <= 20 * 1024 * 1024, 413, 'Fichier de 20 Mo au plus');
  return transaction(settings, 'unoa.internship.report', async store => {
    const item = await internshipOf(store, input.internshipId, true);
    ensure(item.student_id === actor, 403, 'Dépôt réservé au stagiaire');
    ensure(['active', 'report'].includes(item.state), 409, 'Rapport déposé pendant ou à la fin du stage');
    await store.query(`INSERT INTO unoa.internship_report(internship_id, version, confidential, filename, size_bytes, sha256, content, submitted_by)
      VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM unoa.internship_report WHERE internship_id = $1), $2, $3, $4, $5, $6, $7)`,
      [item.id, flag(input.confidential), file.name.slice(0, 200), bytes.byteLength, sha(bytes), Buffer.from(bytes), actor]);
    await store.query("UPDATE unoa.internship SET state = 'report' WHERE id = $1", [item.id]);
    await audit(store, actor, item.scope_id, 'stg.report_deposited', correlation, item.id);
    return { internshipId: item.id };
  });
}

export async function reportFile(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows: [report] } = await store.query<{ internship_id: string; filename: string; confidential: boolean; content: Buffer }>(
    'SELECT internship_id, filename, confidential, content FROM unoa.internship_report WHERE id = $1', [uuid(id)]);
  ensure(report, 404, 'Rapport introuvable');
  const relation = await relationOf(store, actor, await internshipOf(store, report.internship_id));
  ensure(relation && (!report.confidential || relation !== 'company'), 403, 'Rapport confidentiel : réservé au stagiaire, à ses encadrants et à l’établissement');
  return report;
}

// --------------------------------------------------------------- read models

async function details(store: Queryable, actor: string, item: InternshipRow, relation: Relation) {
  const [names, supervisors, signatures, logs, messages, reports, reviews, events] = await Promise.all([
    store.query<{ student: string | null; company: string; scope: string; unit: string | null }>(`SELECT student.display_name AS student, company.name AS company, scope.label AS scope,
      (SELECT code || ' — ' || title FROM unoa.teaching_unit WHERE id = $4) AS unit FROM unoa.account AS student, unoa.company, unoa.scope
      WHERE student.id = $1 AND company.id = $2 AND scope.id = $3`, [item.student_id, item.company_id, item.scope_id, item.unit_id]),
    store.query<{ role: string; name: string | null; assigned_at: Date; ended_at: Date | null; end_reason: string | null }>(`SELECT supervisor.role, account.display_name AS name, supervisor.assigned_at,
      supervisor.ended_at, supervisor.end_reason FROM unoa.internship_supervisor AS supervisor JOIN unoa.account ON account.id = supervisor.account_id WHERE supervisor.internship_id = $1 ORDER BY supervisor.assigned_at`, [item.id]),
    store.query<{ party: string; name: string | null; signed_at: Date }>(`SELECT signature.party, account.display_name AS name, signature.signed_at FROM unoa.internship_signature AS signature
      JOIN unoa.account ON account.id = signature.account_id WHERE signature.internship_id = $1 ORDER BY signature.signed_at`, [item.id]),
    store.query<{ kind: string; entry_on: string; body: string; author: string | null; created_at: Date }>(`SELECT log.kind, log.entry_on::text, log.body, account.display_name AS author, log.created_at
      FROM unoa.internship_log AS log JOIN unoa.account ON account.id = log.author_id WHERE log.internship_id = $1 ORDER BY log.entry_on DESC, log.created_at DESC`, [item.id]),
    store.query<{ body: string; author: string | null; created_at: Date }>(`SELECT message.body, account.display_name AS author, message.created_at FROM unoa.internship_message AS message
      JOIN unoa.account ON account.id = message.author_id WHERE message.internship_id = $1 ORDER BY message.created_at`, [item.id]),
    store.query<{ id: string; version: number; confidential: boolean; filename: string; created_at: Date }>(`SELECT id, version, confidential, filename, created_at FROM unoa.internship_report
      WHERE internship_id = $1 AND (NOT confidential OR $2) ORDER BY version`, [item.id, relation !== 'company']),
    store.query<{ role: string; mark: string; comment: string | null; scores: { label: string; score: number; weight: number }[]; reviewer: string | null }>(`SELECT review.role, review.mark, review.comment,
      review.scores, account.display_name AS reviewer FROM unoa.internship_review AS review JOIN unoa.account ON account.id = review.reviewer_id WHERE review.internship_id = $1`, [item.id]),
    store.query<{ kind: string; reason: string; new_start: string | null; new_end: string | null; actor: string | null; created_at: Date }>(`SELECT event.kind, event.reason, event.new_start::text,
      event.new_end::text, account.display_name AS actor, event.created_at FROM unoa.internship_event AS event JOIN unoa.account ON account.id = event.actor_id WHERE event.internship_id = $1 ORDER BY event.created_at`, [item.id]),
  ]);
  const { rows: [grid] } = item.grid_id ? await store.query<{ title: string; criteria: { label: string; weight: number }[]; scale: string }>('SELECT title, criteria, scale FROM unoa.internship_grid WHERE id = $1', [item.grid_id]) : { rows: [] };
  const { rows: [validated] } = await store.query<{ mark: string | null }>('SELECT mark FROM unoa.internship WHERE id = $1', [item.id]);
  const granted = await rights(store, actor, item.scope_id);
  // The student sees the reviews once the internship is validated.
  const showReviews = relation !== 'student' || item.state === 'validated';
  return { internship: item, relation, rights: granted, ...names.rows[0], supervisors: supervisors.rows, signatures: signatures.rows, logs: logs.rows, messages: messages.rows,
    reports: reports.rows, reviews: showReviews ? reviews.rows : [], events: events.rows, grid: grid ?? null, mark: validated?.mark ?? null,
    tutor: await supervisor(store, item.id, 'company'), academic: await supervisor(store, item.id, 'academic') };
}

export async function internshipDetails(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const item = await internshipOf(store, id);
  const relation = await relationOf(store, actor, item);
  ensure(relation, 403, 'Stage inaccessible');
  const file = await details(store, actor, item, relation);
  const team = ['company', 'staff'].includes(relation) || (await rights(store, actor, item.scope_id))?.manage
    ? (await store.query<{ id: string; name: string | null; role: string }>(`SELECT member.account_id AS id, account.display_name AS name, member.role FROM unoa.company_member AS member
      JOIN unoa.account ON account.id = member.account_id WHERE member.company_id = $1 AND member.removed_at IS NULL ORDER BY account.display_name`, [item.company_id])).rows : [];
  const people = file.rights?.manage ? (await store.query<{ id: string; name: string | null }>('SELECT id, name FROM unoa.scope_people($1, NULL) WHERE id <> $2 ORDER BY name LIMIT 300', [item.scope_id, item.student_id])).rows : [];
  const options = file.rights?.manage && item.state === 'approved' ? await Promise.all([
    store.query<{ id: string; title: string }>('SELECT id, title FROM unoa.internship_template WHERE approved_at IS NOT NULL AND retired_at IS NULL AND unoa.scope_within($1, scope_id) ORDER BY title', [item.scope_id]),
    store.query<{ id: string; title: string }>('SELECT id, title FROM unoa.internship_grid WHERE unoa.scope_within($1, scope_id) ORDER BY created_at DESC', [item.scope_id]),
  ]) : null;
  return { ...file, team, people, templates: options?.[0].rows ?? [], grids: options?.[1].rows ?? [] };
}

export async function internshipSpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [items, registrations, companies] = await Promise.all([
    store.query<{ id: string; title: string; company: string; student: string | null; starts_on: string; ends_on: string; state: string; relation: string }>(`
      SELECT internship.id, internship.title, company.name AS company, account.display_name AS student, internship.starts_on::text, internship.ends_on::text, internship.state,
        CASE WHEN internship.student_id = $1 THEN 'student'
             WHEN EXISTS (SELECT 1 FROM unoa.internship_supervisor WHERE internship_id = internship.id AND account_id = $1 AND role = 'company' AND ended_at IS NULL) THEN 'tutor'
             WHEN EXISTS (SELECT 1 FROM unoa.internship_supervisor WHERE internship_id = internship.id AND account_id = $1 AND role = 'academic' AND ended_at IS NULL) THEN 'academic'
             ELSE 'company' END AS relation
      FROM unoa.internship JOIN unoa.company ON company.id = internship.company_id JOIN unoa.account ON account.id = internship.student_id
      WHERE internship.student_id = $1
         OR EXISTS (SELECT 1 FROM unoa.internship_supervisor WHERE internship_id = internship.id AND account_id = $1 AND ended_at IS NULL)
         OR (internship.state NOT IN ('requested', 'rejected', 'cancelled') AND EXISTS (SELECT 1 FROM unoa.company_member WHERE company_id = internship.company_id AND account_id = $1
             AND role IN ('owner', 'recruiter') AND removed_at IS NULL))
      ORDER BY internship.starts_on DESC`, [actor]),
    store.query<{ id: string; label: string; units: { id: string; title: string }[] }>(`SELECT registration.id, cohort.label || ' · ' || registration.academic_year AS label,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', unit.id, 'title', unit.code || ' — ' || unit.title)) FROM unoa.course_registration AS course JOIN unoa.teaching_unit AS unit ON unit.id = course.unit_id
        WHERE course.registration_id = registration.id AND course.state <> 'withdrawn'), '[]') AS units
      FROM unoa.registration JOIN unoa.student ON student.id = registration.student_id JOIN unoa.cohort ON cohort.id = registration.cohort_id
      WHERE student.account_id = $1 AND registration.state = 'validated' ORDER BY registration.academic_year DESC`, [actor]),
    store.query<{ id: string; name: string; city: string | null }>("SELECT id, name, city FROM unoa.company WHERE state = 'approved' ORDER BY name LIMIT 500"),
  ]);
  return { internships: items.rows, registrations: registrations.rows, companies: companies.rows };
}

export async function internshipContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('institution', 'centre', 'academic_unit') AND unoa.has_scope_permission($1, 'stg.read', scope.id) ORDER BY kind.nature, scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function internshipsOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await requireRight(store, actor, scopeId, 'read');
  const [label, templates, grids, items] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; title: string; legal_reference: string; author: string | null; approved_at: Date | null; retired_at: Date | null; own: boolean }>(`SELECT template.id, template.title,
      template.legal_reference, account.display_name AS author, template.approved_at, template.retired_at, template.author_id = $2 AS own FROM unoa.internship_template AS template
      JOIN unoa.account ON account.id = template.author_id WHERE unoa.scope_within($1, template.scope_id) OR unoa.scope_within(template.scope_id, $1) ORDER BY template.created_at DESC`, [scopeId, actor]),
    store.query<{ id: string; title: string; criteria: { label: string; weight: number }[]; scale: string }>(`SELECT id, title, criteria, scale FROM unoa.internship_grid
      WHERE unoa.scope_within($1, scope_id) OR unoa.scope_within(scope_id, $1) ORDER BY created_at DESC`, [scopeId]),
    store.query<{ id: string; title: string; student: string | null; company: string; starts_on: string; ends_on: string; state: string }>(`SELECT internship.id, internship.title,
      account.display_name AS student, company.name AS company, internship.starts_on::text, internship.ends_on::text, internship.state FROM unoa.internship
      JOIN unoa.account ON account.id = internship.student_id JOIN unoa.company ON company.id = internship.company_id
      WHERE unoa.scope_within(internship.scope_id, $1) ORDER BY internship.state = 'requested' DESC, internship.starts_on DESC LIMIT 500`, [scopeId]),
  ]);
  ensure(label.rows[0], 404, 'Périmètre introuvable');
  return { scope: { id: scopeId, label: label.rows[0].label }, rights: granted, templates: templates.rows, grids: grids.rows, internships: items.rows,
    statistics: await internshipStatistics(store, actor) };
}

// STG-012: internships by country (region of the hierarchy) and state, within what the actor may read.
export async function internshipStatistics(store: Queryable, actor: string) {
  const { rows } = await store.query<{ region: string | null; state: string; total: number; companies: number }>(`
    SELECT country.label AS region, internship.state, count(*)::int AS total, count(DISTINCT internship.company_id)::int AS companies
    FROM unoa.internship LEFT JOIN unoa.scope AS country ON country.id = unoa.scope_country(internship.scope_id)
    WHERE unoa.has_scope_permission($1, 'stg.read', internship.scope_id) GROUP BY country.label, internship.state ORDER BY country.label, internship.state`, [actor]);
  return rows;
}
