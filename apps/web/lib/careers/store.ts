import 'server-only';
import { createHash } from 'node:crypto';
import { matchesFormat } from '@unoa/domain/forms';
import { textPdf, type PdfLine } from '@unoa/domain/pdf';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, https, list, optional, Problem, text, utcTime, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';
import { memberRole } from '@/lib/companies/store';

// Careers (CAR) and opportunities (JOB). A person builds a profile, skills with
// evidence levels, a portfolio and CV versions; a company of the platform reads
// a profile only after explicit consent, and every reading is logged. Offers of
// approved companies are published (or held for review when risky), searched,
// favourited and matched by explainable suggestions; applications are frozen
// at submission and can be withdrawn.

export const kindLabels: Record<string, string> = { internship: 'Stage', job: 'Emploi', apprenticeship: 'Alternance', mission: 'Mission', project: 'Projet' };
export const levelLabels: Record<string, string> = { declared: 'Déclarée', taught: 'Enseignée', assessed: 'Évaluée', validated: 'Validée', certified: 'Certifiée' };
export const declaredLevels: Record<string, string> = { beginner: 'Débutant', intermediate: 'Intermédiaire', advanced: 'Avancé', expert: 'Expert' };
export const applicationStates: Record<string, string> = { submitted: 'Envoyée', shortlisted: 'Présélectionnée', interview: 'Entretien', offer: 'Proposition', rejected: 'Non retenue', withdrawn: 'Retirée' };
export const portfolioKinds: Record<string, string> = { project: 'Projet', experience: 'Expérience', education: 'Formation', certificate: 'Certificat', volunteering: 'Engagement' };
export const documentKinds: Record<string, string> = { cv: 'CV', letter: 'Lettre de motivation', transcript: 'Relevé de notes', other: 'Autre pièce' };
export const consentStatement = 'J’autorise cette entreprise à consulter mon profil carrière, mes compétences et mon portfolio partagé sur UNOA, jusqu’à révocation.';
export const applicationConsent = 'J’accepte que l’entreprise de l’offre consulte ma candidature, mes pièces et l’instantané de mon profil pour ce recrutement.';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const transitions: Record<string, string[]> = { submitted: ['shortlisted', 'rejected'], shortlisted: ['interview', 'rejected'], interview: ['offer', 'rejected'] };

// JOB-003: offers asking money from candidates or moving contact off the platform are held for review.
export function riskFlags(content: string) {
  const flags: string[] = [];
  if (/(frais d.inscription|frais de dossier|payer|paiement|versement|caution|western union|moneygram|mobile money|transfert d.argent)/i.test(content)) flags.push('Paiement demandé au candidat');
  if (/(whatsapp|telegram|@gmail\.|@yahoo\.|@hotmail\.|@outlook\.)/i.test(content)) flags.push('Contact hors de la plateforme');
  if (/(sans expérience.{0,40}(gagnez|revenu garanti)|revenu garanti|gains? rapides?)/i.test(content)) flags.push('Promesse de gains');
  return flags;
}

async function recruiter(store: Queryable, actor: string, companyId: string) {
  const role = await memberRole(store, actor, companyId);
  ensure(role === 'owner' || role === 'recruiter', 403, 'Action réservée aux recruteurs de l’entreprise');
}
async function companyApproved(store: Queryable, companyId: string) {
  const { rows: [company] } = await store.query<{ id: string; scope_id: string; name: string; state: string }>('SELECT id, scope_id, name, state FROM unoa.company WHERE id = $1', [companyId]);
  ensure(company, 404, 'Entreprise introuvable');
  ensure(company.state === 'approved', 422, 'Entreprise non approuvée');
  return company;
}
interface OpportunityRow { id: string; company_id: string; title: string; state: string; opens_at: Date; closes_at: Date; required_documents: string[]; created_by: string; scope_id: string; company: string }
async function opportunityOf(store: Queryable, id: unknown, lock = false) {
  const { rows } = await store.query<OpportunityRow>(`SELECT opportunity.id, opportunity.company_id, opportunity.title, opportunity.state, opportunity.opens_at, opportunity.closes_at,
    opportunity.required_documents, opportunity.created_by, company.scope_id, company.name AS company FROM unoa.opportunity JOIN unoa.company ON company.id = opportunity.company_id
    WHERE opportunity.id = $1${lock ? ' FOR UPDATE OF opportunity' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Offre introuvable');
  return rows[0];
}
interface ApplicationRow { id: string; opportunity_id: string; account_id: string; state: string; company_id: string; title: string; scope_id: string }
async function applicationOf(store: Queryable, id: unknown, lock = false) {
  const { rows } = await store.query<ApplicationRow>(`SELECT application.id, application.opportunity_id, application.account_id, application.state, opportunity.company_id, opportunity.title, company.scope_id
    FROM unoa.job_application AS application JOIN unoa.opportunity ON opportunity.id = application.opportunity_id JOIN unoa.company ON company.id = opportunity.company_id WHERE application.id = $1${lock ? ' FOR UPDATE OF application' : ''}`, [uuid(id)]);
  ensure(rows[0], 404, 'Candidature introuvable');
  return rows[0];
}
async function logAccess(store: Queryable, accountId: string, companyId: string, actor: string, resource: 'profile' | 'application' | 'document' | 'cv') {
  await store.query('INSERT INTO unoa.recruiter_access(account_id, company_id, recruiter_id, resource) VALUES ($1, $2, $3, $4)', [accountId, companyId, actor, resource]);
}

// ------------------------------------------------------------ profile pieces

async function profileOf(store: Queryable, accountId: string) {
  const [account, profile, skills, declared, portfolio] = await Promise.all([
    store.query<{ name: string | null }>('SELECT display_name AS name FROM unoa.account WHERE id = $1', [accountId]),
    store.query<{ headline: string | null; summary: string | null; country: string | null; languages: string[]; availability: string | null; open_to_offers: boolean }>(
      'SELECT headline, summary, country, languages, availability, open_to_offers FROM unoa.career_profile WHERE account_id = $1', [accountId]),
    store.query<{ competency_id: string; code: string; label: string; level: string; evidence: string }>('SELECT * FROM unoa.career_skills($1)', [accountId]),
    store.query<{ id: string; label: string; level: string; competency_id: string | null }>('SELECT id, label, level, competency_id FROM unoa.declared_skill WHERE account_id = $1 AND removed_at IS NULL ORDER BY label', [accountId]),
    store.query<{ id: string; kind: string; title: string; organisation: string | null; description: string | null; starts_on: string | null; ends_on: string | null; url: string | null;
      shared: boolean; verified: boolean }>(`SELECT id, kind, title, organisation, description, starts_on::text, ends_on::text, url, shared, verified_at IS NOT NULL AS verified
      FROM unoa.portfolio_item WHERE account_id = $1 AND removed_at IS NULL ORDER BY coalesce(ends_on, starts_on, created_at::date) DESC`, [accountId]),
  ]);
  return { name: account.rows[0]?.name ?? null, profile: profile.rows[0] ?? null, skills: skills.rows, declared: declared.rows, portfolio: portfolio.rows };
}
// What a company sees: evidence-based skills, declared skills marked as such, shared portfolio items only.
function shareable(data: Awaited<ReturnType<typeof profileOf>>) {
  return { name: data.name, profile: data.profile, skills: data.skills, declared: data.declared.map(item => ({ label: item.label, level: item.level, status: 'déclarée (non vérifiée)' })),
    portfolio: data.portfolio.filter(item => item.shared).map(item => ({ ...item, status: item.verified ? 'vérifiée' : 'non vérifiée' })) };
}

function cvLines(data: Awaited<ReturnType<typeof profileOf>>, title: string): PdfLine[] {
  const lines: PdfLine[] = [{ text: data.name ?? 'Curriculum vitæ', size: 20, bold: true }, { text: title, size: 12 }];
  if (data.profile?.headline) lines.push({ text: data.profile.headline, size: 12, bold: true, gap: 6 });
  const facts = [data.profile?.country, data.profile?.languages.length ? 'Langues : ' + data.profile.languages.join(', ') : null, data.profile?.availability].filter(Boolean).join(' · ');
  if (facts) lines.push({ text: facts, size: 10 });
  if (data.profile?.summary) lines.push({ text: data.profile.summary, gap: 6 });
  if (data.skills.length) {
    lines.push({ text: 'Compétences attestées', size: 14, bold: true, gap: 14 });
    for (const skill of data.skills) lines.push({ text: `• ${skill.label} — ${levelLabels[skill.level]} (${skill.evidence})`, size: 10 });
  }
  if (data.declared.length) {
    lines.push({ text: 'Compétences déclarées (non vérifiées)', size: 14, bold: true, gap: 14 });
    for (const skill of data.declared) lines.push({ text: `• ${skill.label} — ${declaredLevels[skill.level]}`, size: 10 });
  }
  if (data.portfolio.length) {
    lines.push({ text: 'Parcours et réalisations', size: 14, bold: true, gap: 14 });
    for (const item of data.portfolio) {
      lines.push({ text: `${portfolioKinds[item.kind]} — ${item.title}${item.organisation ? ', ' + item.organisation : ''}${item.verified ? '' : ' (non vérifié)'}`, size: 11, bold: true, gap: 4 });
      if (item.starts_on || item.ends_on) lines.push({ text: `${item.starts_on ?? '…'} → ${item.ends_on ?? 'en cours'}`, size: 9 });
      if (item.description) lines.push({ text: item.description, size: 10 });
    }
  }
  lines.push({ text: 'Généré par UNOA. Les niveaux « certifiée » et « validée » renvoient à des décisions officielles vérifiables ; les autres ne valent pas diplôme.', size: 8, gap: 20 });
  return lines;
}

function fileOf(input: Input, key: string) {
  const file = input[key];
  return file instanceof File && file.size > 0 ? file : null;
}
async function readDocument(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  const format = extension === 'jpeg' ? 'jpg' : extension;
  ensure(['pdf', 'png', 'jpg'].includes(format) && matchesFormat(bytes, format), 400, 'Formats acceptés : PDF, PNG, JPG');
  ensure(bytes.byteLength <= 10 * 1024 * 1024, 413, 'Fichier de 10 Mo au plus');
  return bytes;
}

// ------------------------------------------------------------------ actions

export async function careerAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'apply') return apply(settings, actor, input, correlation);
  return transaction(settings, 'unoa.career.' + action, async store => {
    switch (action) {
      case 'profile': {
        const languages = list(String(input.languages ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean), 12);
        ensure(languages.every(item => /^[a-z]{2,3}$/.test(item)), 400, 'Langues : codes à 2 ou 3 lettres séparés par des virgules (fr, en…)');
        const values = [actor, optional(input.headline, text(200, 'Titre')), optional(input.summary, text(4000, 'Présentation')), optional(input.country, text(100, 'Pays')), languages,
          optional(input.availability, text(300, 'Disponibilité')), flag(input.openToOffers)];
        await store.query(`INSERT INTO unoa.career_profile(account_id, headline, summary, country, languages, availability, open_to_offers) VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (account_id) DO UPDATE SET headline = $2, summary = $3, country = $4, languages = $5, availability = $6, open_to_offers = $7, updated_at = now()`, values);
        return {};
      }
      case 'declare': {
        const competencyId = optional(input.competencyId, uuid);
        let label = optional(input.label, text(200, 'Compétence'));
        if (competencyId) {
          const { rows: [found] } = await store.query<{ label: string }>('SELECT label FROM unoa.competency WHERE id = $1', [competencyId]);
          ensure(found, 404, 'Compétence introuvable');
          label = found.label;
        }
        ensure(label, 400, 'Indiquez une compétence');
        await store.query('INSERT INTO unoa.declared_skill(account_id, competency_id, label, level) VALUES ($1, $2, $3, $4)',
          [actor, competencyId, label, choice(input.level, ['beginner', 'intermediate', 'advanced', 'expert'] as const, 'Niveau')]);
        return {};
      }
      case 'undeclare': {
        const result = await store.query('UPDATE unoa.declared_skill SET removed_at = now() WHERE id = $1 AND account_id = $2 AND removed_at IS NULL', [uuid(input.skillId), actor]);
        ensure(result.rowCount === 1, 404, 'Compétence introuvable');
        return {};
      }
      case 'portfolio': {
        const startsOn = optional(input.startsOn, value => day(value, 'Début')); const endsOn = optional(input.endsOn, value => day(value, 'Fin'));
        ensure(!startsOn || !endsOn || endsOn >= startsOn, 400, 'La fin suit le début');
        await store.query(`INSERT INTO unoa.portfolio_item(account_id, kind, title, organisation, description, starts_on, ends_on, url, shared) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [actor, choice(input.kind, ['project', 'experience', 'education', 'certificate', 'volunteering'] as const, 'Nature'), boundedText(input.title, 300, 'Intitulé'),
            optional(input.organisation, text(300, 'Organisation')), optional(input.description, text(4000, 'Description')), startsOn, endsOn,
            optional(input.url, value => https(value, 'Lien')), flag(input.shared)]);
        return {};
      }
      case 'portfolio-share':
      case 'portfolio-remove': {
        const result = action === 'portfolio-share'
          ? await store.query('UPDATE unoa.portfolio_item SET shared = $3 WHERE id = $1 AND account_id = $2 AND removed_at IS NULL', [uuid(input.itemId), actor, flag(input.shared)])
          : await store.query('UPDATE unoa.portfolio_item SET removed_at = now() WHERE id = $1 AND account_id = $2 AND removed_at IS NULL', [uuid(input.itemId), actor]);
        ensure(result.rowCount === 1, 404, 'Élément introuvable');
        return {};
      }
      case 'portfolio-verify': {
        const { rows: [item] } = await store.query<{ id: string; account_id: string; verified_at: Date | null }>('SELECT id, account_id, verified_at FROM unoa.portfolio_item WHERE id = $1 AND removed_at IS NULL FOR UPDATE', [uuid(input.itemId)]);
        ensure(item, 404, 'Élément introuvable');
        ensure(item.account_id !== actor, 403, 'Une personne ne vérifie pas son propre parcours');
        const { rows } = await store.query(`SELECT 1 FROM unoa.student WHERE account_id = $1 AND unoa.has_scope_permission($2, 'car.verify', institution_id)`, [item.account_id, actor]);
        ensure(rows[0], 403, 'Vérification réservée à l’établissement de la personne');
        ensure(!item.verified_at, 409, 'Déjà vérifié');
        await store.query('UPDATE unoa.portfolio_item SET verified_by = $2, verified_at = now() WHERE id = $1', [item.id, actor]);
        return {};
      }
      case 'cv': {
        const title = boundedText(input.title, 200, 'Intitulé');
        const data = await profileOf(store, actor);
        const pdf = textPdf(title, cvLines(data, title));
        const content = { ...data, title, generatedAt: new Date().toISOString() };
        const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.cv_version(account_id, version, title, content, pdf, sha256)
          VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM unoa.cv_version WHERE account_id = $1), $2, $3, $4, $5) RETURNING id`,
          [actor, title, JSON.stringify(content), Buffer.from(pdf), sha(pdf)]);
        return { cvId: rows[0].id };
      }
      case 'consent': {
        const company = await companyApproved(store, uuid(input.companyId));
        ensure(flag(input.agree), 422, 'Cochez l’accord explicite');
        await store.query('INSERT INTO unoa.career_consent(account_id, company_id, statement) VALUES ($1, $2, $3)', [actor, company.id, consentStatement]).catch(error => {
          if (error?.code === '23505') throw new Problem(409, 'Accord déjà donné à cette entreprise');
          throw error;
        });
        await audit(store, actor, company.scope_id, 'car.consent_granted', correlation, company.id);
        return {};
      }
      case 'revoke': {
        const result = await store.query('UPDATE unoa.career_consent SET revoked_at = now() WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL', [uuid(input.consentId), actor]);
        ensure(result.rowCount === 1, 404, 'Accord introuvable ou déjà révoqué');
        return {};
      }
      case 'favorite': {
        const opportunity = await opportunityOf(store, input.opportunityId);
        ensure(opportunity.state === 'published', 422, 'Offre non publiée');
        await store.query('INSERT INTO unoa.job_favorite(account_id, opportunity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [actor, opportunity.id]);
        return {};
      }
      case 'unfavorite':
        await store.query('DELETE FROM unoa.job_favorite WHERE account_id = $1 AND opportunity_id = $2', [actor, uuid(input.opportunityId)]);
        return {};
      case 'alert': {
        const kind = optional(input.kind, value => choice(value, ['internship', 'job', 'apprenticeship', 'mission', 'project'] as const, 'Nature'));
        const language = optional(input.language, value => { const code = String(value).trim().toLowerCase(); ensure(/^[a-z]{2,3}$/.test(code), 400, 'Langue invalide'); return code; });
        await store.query('INSERT INTO unoa.job_alert(account_id, label, kind, country, language, keywords) VALUES ($1, $2, $3, $4, $5, $6)',
          [actor, boundedText(input.label, 200, 'Nom de l’alerte'), kind, optional(input.country, text(100, 'Pays')), language, optional(input.keywords, text(200, 'Mots-clés'))]);
        return {};
      }
      case 'alert-remove': {
        const result = await store.query('UPDATE unoa.job_alert SET removed_at = now() WHERE id = $1 AND account_id = $2 AND removed_at IS NULL', [uuid(input.alertId), actor]);
        ensure(result.rowCount === 1, 404, 'Alerte introuvable');
        return {};
      }
      case 'withdraw': {
        const application = await applicationOf(store, input.applicationId, true);
        ensure(application.account_id === actor, 403, 'Seul le candidat retire sa candidature');
        ensure(!['withdrawn', 'rejected'].includes(application.state), 409, 'Candidature déjà close');
        // JOB-011: documents and profile snapshot are erased; the trace of the application and its digest remain.
        await store.query(`UPDATE unoa.job_application SET state = 'withdrawn', withdrawn_at = now(), snapshot = '{"retire": true}' WHERE id = $1`, [application.id]);
        await store.query('UPDATE unoa.job_application_document SET content = NULL, purged_at = now() WHERE application_id = $1 AND content IS NOT NULL', [application.id]);
        await store.query("UPDATE unoa.interview SET state = 'cancelled', cancel_reason = 'Candidature retirée' WHERE application_id = $1 AND state <> 'cancelled'", [application.id]);
        await store.query("INSERT INTO unoa.job_application_event(application_id, state, note, actor_id) VALUES ($1, 'withdrawn', 'Retrait par le candidat', $2)", [application.id, actor]);
        return {};
      }
      case 'confirm-interview': {
        const { rows: [interview] } = await store.query<{ id: string; application_id: string; state: string }>('SELECT id, application_id, state FROM unoa.interview WHERE id = $1 FOR UPDATE', [uuid(input.interviewId)]);
        ensure(interview, 404, 'Entretien introuvable');
        const application = await applicationOf(store, interview.application_id);
        ensure(application.account_id === actor, 403, 'Confirmation par le candidat');
        ensure(interview.state === 'proposed', 409, 'Entretien déjà confirmé ou annulé');
        await store.query("UPDATE unoa.interview SET state = 'confirmed', confirmed_at = now() WHERE id = $1", [interview.id]);
        return {};
      }
      case 'report-opportunity': {
        const opportunity = await opportunityOf(store, input.opportunityId);
        await store.query('INSERT INTO unoa.opportunity_report(opportunity_id, reporter_id, reason) VALUES ($1, $2, $3)', [opportunity.id, actor, boundedText(input.reason, 2000, 'Motif')]);
        await audit(store, actor, opportunity.scope_id, 'job.reported', correlation, opportunity.id);
        return {};
      }
      default:
        return recruitingAction(store, actor, action, input, correlation);
    }
  });
}

async function apply(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const files: { kind: string; file: File; bytes: Uint8Array }[] = [];
  for (const kind of ['cv', 'letter', 'transcript', 'other']) {
    const file = fileOf(input, kind + 'File');
    if (file) files.push({ kind, file, bytes: await readDocument(file) });
  }
  return transaction(settings, 'unoa.career.apply', async store => {
    const opportunity = await opportunityOf(store, input.opportunityId);
    const now = Date.now();
    ensure(opportunity.state === 'published' && opportunity.opens_at.getTime() <= now && opportunity.closes_at.getTime() > now, 422, 'Candidature hors délai ou offre fermée');
    ensure(input.consent === 'on' || input.consent === true, 422, 'Le consentement explicite est requis pour candidater');
    ensure(!(await memberRole(store, actor, opportunity.company_id)), 403, 'Un membre de l’entreprise ne candidate pas à ses offres');
    const cvVersionId = optional(input.cvVersionId, uuid);
    if (cvVersionId) ensure((await store.query('SELECT 1 FROM unoa.cv_version WHERE id = $1 AND account_id = $2', [cvVersionId, actor])).rows[0], 403, 'CV d’une autre personne');
    const letter = optional(input.letter, text(8000, 'Lettre'));
    const kinds = new Set(files.map(item => item.kind));
    for (const required of opportunity.required_documents) {
      const met = kinds.has(required) || (required === 'cv' && cvVersionId) || (required === 'letter' && letter);
      ensure(met, 422, 'Pièce exigée manquante : ' + documentKinds[required]);
    }
    const snapshot = { ...shareable(await profileOf(store, actor)), cvVersionId, frozenAt: new Date().toISOString() };
    const serialized = JSON.stringify(snapshot);
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.job_application(opportunity_id, account_id, consent_statement, snapshot, snapshot_sha256, cv_version_id, letter)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, [opportunity.id, actor, applicationConsent, serialized, sha(serialized), cvVersionId, letter]).catch(error => {
      if (error?.code === '23505') throw new Problem(409, 'Vous avez déjà candidaté à cette offre');
      throw error;
    });
    for (const item of files) {
      await store.query('INSERT INTO unoa.job_application_document(application_id, kind, filename, size_bytes, sha256, content) VALUES ($1, $2, $3, $4, $5, $6)',
        [rows[0].id, item.kind, item.file.name.slice(0, 200), item.bytes.byteLength, sha(item.bytes), Buffer.from(item.bytes)]);
    }
    await store.query("INSERT INTO unoa.job_application_event(application_id, state, actor_id) VALUES ($1, 'submitted', $2)", [rows[0].id, actor]);
    const { rows: team } = await store.query<{ account_id: string }>("SELECT account_id FROM unoa.company_member WHERE company_id = $1 AND role IN ('owner', 'recruiter') AND removed_at IS NULL", [opportunity.company_id]);
    await dispatch(store, { event: 'job.application', scopeId: opportunity.scope_id, recipients: team.map(row => row.account_id), correlation, values: { title: opportunity.title }, link: '/entreprise/recrutement' });
    await audit(store, actor, opportunity.scope_id, 'job.applied', correlation, rows[0].id);
    return { applicationId: rows[0].id };
  });
}

async function recruitingAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  switch (action) {
    case 'opportunities': {
      const company = await companyApproved(store, uuid(input.companyId));
      await recruiter(store, actor, company.id);
      const title = boundedText(input.title, 300, 'Intitulé'); const description = boundedText(input.description, 10000, 'Description');
      ensure(description.trim().length >= 20, 400, 'Description trop courte');
      const criteria = optional(input.criteria, text(4000, 'Critères'));
      const opensAt = optional(input.opensAt, utcTime) ?? new Date().toISOString(); const closesAt = utcTime(input.closesAt);
      ensure(new Date(closesAt) > new Date(opensAt), 400, 'La clôture suit l’ouverture');
      const languages = String(input.languages ?? '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean).slice(0, 12);
      ensure(languages.every(item => /^[a-z]{2,3}$/.test(item)), 400, 'Langues : codes à 2 ou 3 lettres');
      const competencies = (Array.isArray(input.competencies) ? input.competencies : String(input.competencies ?? '').split(',')).map(item => String(item).trim()).filter(Boolean).map(uuid).slice(0, 30);
      const documents = (Array.isArray(input.requiredDocuments) ? input.requiredDocuments : String(input.requiredDocuments ?? 'cv').split(',')).map(item => String(item).trim()).filter(Boolean);
      ensure(documents.every(item => ['cv', 'letter', 'transcript', 'other'].includes(item)), 400, 'Pièce exigée inconnue');
      const flags = riskFlags([title, description, criteria ?? ''].join(' '));
      const state = flags.length ? 'review' : 'published';
      const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.opportunity(company_id, kind, title, description, criteria, country, city, remote, languages, competencies, required_documents,
        starts_on, opens_at, closes_at, state, risk_flags, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
        [company.id, choice(input.kind, ['internship', 'job', 'apprenticeship', 'mission', 'project'] as const, 'Nature'), title, description, criteria, boundedText(input.country, 100, 'Pays'),
          optional(input.city, text(200, 'Ville')), flag(input.remote), languages, competencies, documents.length ? documents : ['cv'], optional(input.startsOn, value => day(value, 'Début')),
          opensAt, closesAt, state, flags, actor]);
      if (state === 'published') await alert(store, rows[0].id, correlation);
      await audit(store, actor, company.scope_id, 'job.opportunity_' + state, correlation, rows[0].id);
      return { opportunityId: rows[0].id, state, flags };
    }
    case 'opportunity-close': {
      const opportunity = await opportunityOf(store, input.opportunityId, true);
      await recruiter(store, actor, opportunity.company_id);
      ensure(opportunity.state !== 'closed', 409, 'Offre déjà close');
      await store.query("UPDATE unoa.opportunity SET state = 'closed' WHERE id = $1", [opportunity.id]);
      return {};
    }
    case 'moderate': {
      const opportunity = await opportunityOf(store, input.opportunityId, true);
      const { rows: [allowed] } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'ent.verify', $2) AS ok", [actor, opportunity.scope_id]);
      ensure(allowed?.ok, 403, 'Modération réservée à l’établissement');
      ensure(opportunity.created_by !== actor, 403, 'L’auteur ne modère pas son offre');
      const decision = choice(input.decision, ['published', 'suspended'] as const, 'Décision');
      const note = optional(input.note, text(2000, 'Observation'));
      ensure(decision === 'published' || note, 400, 'Motivez la suspension');
      ensure(decision === 'suspended' ? ['review', 'published'].includes(opportunity.state) : ['review', 'suspended'].includes(opportunity.state), 409, 'Décision impossible dans l’état actuel');
      await store.query('UPDATE unoa.opportunity SET state = $2, moderated_by = $3, moderation_note = $4 WHERE id = $1', [opportunity.id, decision, actor, note]);
      if (decision === 'published') await alert(store, opportunity.id, correlation);
      await audit(store, actor, opportunity.scope_id, 'job.moderated_' + decision, correlation, opportunity.id);
      return { scopeId: opportunity.scope_id };
    }
    case 'handle-opportunity-report': {
      const { rows: [report] } = await store.query<{ id: string; opportunity_id: string; state: string }>('SELECT id, opportunity_id, state FROM unoa.opportunity_report WHERE id = $1 FOR UPDATE', [uuid(input.reportId)]);
      ensure(report, 404, 'Signalement introuvable');
      const opportunity = await opportunityOf(store, report.opportunity_id);
      const { rows: [allowed] } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'ent.manage', $2) AS ok", [actor, opportunity.scope_id]);
      ensure(allowed?.ok, 403, 'Traitement réservé à l’établissement');
      ensure(report.state === 'open', 409, 'Signalement déjà traité');
      await store.query("UPDATE unoa.opportunity_report SET state = 'closed', outcome = $2, handled_by = $3 WHERE id = $1", [report.id, boundedText(input.outcome, 2000, 'Suite donnée'), actor]);
      return { scopeId: opportunity.scope_id };
    }
    case 'application-status': {
      const application = await applicationOf(store, input.applicationId, true);
      await recruiter(store, actor, application.company_id);
      const state = choice(input.state, ['shortlisted', 'interview', 'offer', 'rejected'] as const, 'Statut');
      ensure((transitions[application.state] ?? []).includes(state), 409, 'Changement de statut impossible');
      await store.query('UPDATE unoa.job_application SET state = $2 WHERE id = $1', [application.id, state]);
      await store.query('INSERT INTO unoa.job_application_event(application_id, state, note, actor_id) VALUES ($1, $2, $3, $4)', [application.id, state, optional(input.note, text(2000, 'Observation')), actor]);
      await dispatch(store, { event: 'job.status', scopeId: application.scope_id, recipients: [application.account_id], correlation, values: { title: application.title, status: applicationStates[state].toLowerCase() }, link: '/carriere#candidatures' });
      return {};
    }
    case 'interviews': {
      const application = await applicationOf(store, input.applicationId, true);
      await recruiter(store, actor, application.company_id);
      ensure(['shortlisted', 'interview'].includes(application.state), 409, 'Entretien après présélection');
      const startsAt = utcTime(input.startsAt);
      ensure(new Date(startsAt).getTime() > Date.now(), 422, 'Entretien dans le futur');
      const mode = choice(input.mode, ['onsite', 'online', 'phone'] as const, 'Modalité');
      await store.query('INSERT INTO unoa.interview(application_id, starts_at, duration_minutes, mode, place, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [application.id, startsAt, Number(input.durationMinutes ?? 45), mode, optional(input.place, text(500, 'Lieu ou lien')), actor]).catch(error => {
        if (error?.code === '23514') throw new Problem(400, 'Durée entre 10 et 480 minutes');
        throw error;
      });
      if (application.state === 'shortlisted') {
        await store.query("UPDATE unoa.job_application SET state = 'interview' WHERE id = $1", [application.id]);
        await store.query("INSERT INTO unoa.job_application_event(application_id, state, actor_id) VALUES ($1, 'interview', $2)", [application.id, actor]);
      }
      await dispatch(store, { event: 'job.interview', scopeId: application.scope_id, recipients: [application.account_id], correlation,
        values: { title: application.title, date: new Date(startsAt).toLocaleString('fr-FR', { timeZone: 'UTC' }) + ' UTC' }, link: '/carriere#candidatures' });
      return {};
    }
    case 'cancel-interview': {
      const { rows: [interview] } = await store.query<{ id: string; application_id: string; state: string }>('SELECT id, application_id, state FROM unoa.interview WHERE id = $1 FOR UPDATE', [uuid(input.interviewId)]);
      ensure(interview, 404, 'Entretien introuvable');
      const application = await applicationOf(store, interview.application_id);
      ensure(application.account_id === actor || ['owner', 'recruiter'].includes(await memberRole(store, actor, application.company_id) ?? ''), 403, 'Annulation par les parties');
      ensure(interview.state !== 'cancelled', 409, 'Déjà annulé');
      await store.query("UPDATE unoa.interview SET state = 'cancelled', cancel_reason = $2 WHERE id = $1", [interview.id, boundedText(input.reason, 1000, 'Motif')]);
      return {};
    }
    case 'link-course': case 'unlink-course': {
      const courseId = uuid(input.courseId); const competencyId = uuid(input.competencyId);
      const { rows: [course] } = await store.query<{ owner_scope_id: string }>('SELECT owner_scope_id FROM unoa.course WHERE id = $1', [courseId]);
      ensure(course, 404, 'Cours introuvable');
      const { rows: [allowed] } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'catalog.write', $2) AS ok", [actor, course.owner_scope_id]);
      ensure(allowed?.ok, 403, 'Liens réservés aux responsables du catalogue');
      if (action === 'link-course') await store.query('INSERT INTO unoa.course_competency(course_id, competency_id, linked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [courseId, competencyId, actor]);
      else await store.query('DELETE FROM unoa.course_competency WHERE course_id = $1 AND competency_id = $2', [courseId, competencyId]);
      return {};
    }
    case 'link-assessment': case 'unlink-assessment': {
      const assessmentId = uuid(input.assessmentId); const competencyId = uuid(input.competencyId);
      const { rows: [teacher] } = await store.query(`SELECT 1 FROM unoa.assessment JOIN unoa.offering_member AS member ON member.offering_id = assessment.offering_id
        WHERE assessment.id = $1 AND member.account_id = $2 AND member.role = 'teacher' AND member.removed_at IS NULL`, [assessmentId, actor]);
      ensure(teacher, 403, 'Liens réservés aux enseignants de l’offre de cours');
      if (action === 'link-assessment') await store.query('INSERT INTO unoa.assessment_competency(assessment_id, competency_id, linked_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [assessmentId, competencyId, actor]);
      else await store.query('DELETE FROM unoa.assessment_competency WHERE assessment_id = $1 AND competency_id = $2', [assessmentId, competencyId]);
      return {};
    }
    case 'competency-label': {
      const competencyId = uuid(input.competencyId);
      const { rows: [competency] } = await store.query<{ owner_scope_id: string }>('SELECT owner_scope_id FROM unoa.competency WHERE id = $1', [competencyId]);
      ensure(competency, 404, 'Compétence introuvable');
      const { rows: [allowed] } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'catalog.write', $2) AS ok", [actor, competency.owner_scope_id]);
      ensure(allowed?.ok, 403, 'Référentiel réservé aux responsables du catalogue');
      const language = String(input.language ?? '').trim();
      ensure(/^[a-z]{2,3}(-[A-Z]{2})?$/.test(language), 400, 'Langue invalide');
      await store.query(`INSERT INTO unoa.competency_label(competency_id, language, label, updated_by) VALUES ($1, $2, $3, $4)
        ON CONFLICT (competency_id, language) DO UPDATE SET label = $3, updated_by = $4, updated_at = now()`, [competencyId, language, boundedText(input.label, 200, 'Libellé'), actor]);
      return {};
    }
    default:
      throw new Problem(404, 'Opération inconnue');
  }
}

// JOB-005: opt-in alerts notified when an offer is published.
async function alert(store: Queryable, opportunityId: string, correlation: string) {
  const { rows: [offer] } = await store.query<{ title: string; company: string; kind: string; country: string; languages: string[]; description: string; scope_id: string }>(
    `SELECT opportunity.title, company.name AS company, opportunity.kind, opportunity.country, opportunity.languages, opportunity.description, company.scope_id
     FROM unoa.opportunity JOIN unoa.company ON company.id = opportunity.company_id WHERE opportunity.id = $1`, [opportunityId]);
  const { rows } = await store.query<{ account_id: string }>(`SELECT DISTINCT account_id FROM unoa.job_alert WHERE removed_at IS NULL
    AND (kind IS NULL OR kind = $1) AND (country IS NULL OR lower(country) = lower($2)) AND (language IS NULL OR language = ANY($3))
    AND (keywords IS NULL OR position(lower(keywords) IN lower($4 || ' ' || $5)) > 0)`, [offer.kind, offer.country, offer.languages, offer.title, offer.description]);
  await dispatch(store, { event: 'job.alert', scopeId: offer.scope_id, recipients: rows.map(row => row.account_id), correlation, values: { title: offer.title, company: offer.company },
    link: '/offres?id=' + opportunityId });
}

// --------------------------------------------------------------- read models

export interface OfferFilters { q?: string; kind?: string; country?: string; language?: string; competency?: string }
export async function publicOpportunities(settings: IamSettings, filters: OfferFilters) {
  const { rows } = await database(settings).query<{ id: string; title: string; kind: string; company: string; country: string; city: string | null; remote: boolean; languages: string[];
    closes_at: Date; skills: string[] }>(`
    SELECT opportunity.id, opportunity.title, opportunity.kind, company.name AS company, opportunity.country, opportunity.city, opportunity.remote, opportunity.languages, opportunity.closes_at,
      coalesce((SELECT array_agg(competency.label ORDER BY competency.label) FROM unoa.competency WHERE competency.id = ANY(opportunity.competencies)), '{}') AS skills
    FROM unoa.opportunity JOIN unoa.company ON company.id = opportunity.company_id
    WHERE opportunity.state = 'published' AND company.state = 'approved' AND opportunity.opens_at <= now() AND opportunity.closes_at > now()
      AND ($1::text IS NULL OR opportunity.title ILIKE '%' || $1 || '%' OR opportunity.description ILIKE '%' || $1 || '%' OR company.name ILIKE '%' || $1 || '%')
      AND ($2::text IS NULL OR opportunity.kind = $2) AND ($3::text IS NULL OR lower(opportunity.country) = lower($3))
      AND ($4::text IS NULL OR $4 = ANY(opportunity.languages)) AND ($5::uuid IS NULL OR $5 = ANY(opportunity.competencies))
    ORDER BY opportunity.closes_at LIMIT 200`, [filters.q?.trim().slice(0, 100) || null, filters.kind && kindLabels[filters.kind] ? filters.kind : null,
    filters.country?.trim().slice(0, 100) || null, filters.language && /^[a-z]{2,3}$/.test(filters.language) ? filters.language : null,
    filters.competency && /^[0-9a-f-]{36}$/.test(filters.competency) ? filters.competency : null]);
  return rows;
}

export async function opportunityDetail(settings: IamSettings, id: string, actor: string | null) {
  const store = database(settings);
  const { rows: [offer] } = await store.query<{ id: string; title: string; kind: string; description: string; criteria: string | null; country: string; city: string | null; remote: boolean;
    languages: string[]; required_documents: string[]; starts_on: string | null; opens_at: Date; closes_at: Date; state: string; company_id: string; company: string; company_city: string | null;
    skills: { id: string; label: string }[] }>(`SELECT opportunity.id, opportunity.title, opportunity.kind, opportunity.description, opportunity.criteria, opportunity.country, opportunity.city,
    opportunity.remote, opportunity.languages, opportunity.required_documents, opportunity.starts_on::text, opportunity.opens_at, opportunity.closes_at, opportunity.state,
    company.id AS company_id, company.name AS company, company.city AS company_city,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', competency.id, 'label', competency.label)) FROM unoa.competency WHERE competency.id = ANY(opportunity.competencies)), '[]') AS skills
    FROM unoa.opportunity JOIN unoa.company ON company.id = opportunity.company_id WHERE opportunity.id = $1`, [uuid(id)]);
  ensure(offer, 404, 'Offre introuvable');
  const own = actor ? ['owner', 'recruiter'].includes(await memberRole(store, actor, offer.company_id) ?? '') : false;
  ensure(offer.state === 'published' || own, 404, 'Offre introuvable');
  const mine = actor ? (await store.query<{ id: string; state: string }>('SELECT id, state FROM unoa.job_application WHERE opportunity_id = $1 AND account_id = $2', [offer.id, actor])).rows[0] ?? null : null;
  const cvs = actor ? (await store.query<{ id: string; version: number; title: string }>('SELECT id, version, title FROM unoa.cv_version WHERE account_id = $1 ORDER BY version DESC', [actor])).rows : [];
  const favorite = actor ? !!(await store.query('SELECT 1 FROM unoa.job_favorite WHERE account_id = $1 AND opportunity_id = $2', [actor, offer.id])).rows[0] : false;
  return { offer, own, mine, cvs, favorite, open: offer.state === 'published' && offer.opens_at.getTime() <= Date.now() && offer.closes_at.getTime() > Date.now() };
}

// CAR-007: suggestions explained by matched skills, language and country; no personal attribute is used.
async function suggestions(store: Queryable, actor: string, skills: { competency_id: string; label: string; level: string }[], profile: { country: string | null; languages: string[] } | null) {
  const { rows } = await store.query<{ id: string; title: string; company: string; kind: string; country: string; languages: string[]; competencies: string[] }>(`
    SELECT opportunity.id, opportunity.title, company.name AS company, opportunity.kind, opportunity.country, opportunity.languages, opportunity.competencies
    FROM unoa.opportunity JOIN unoa.company ON company.id = opportunity.company_id
    WHERE opportunity.state = 'published' AND company.state = 'approved' AND opportunity.opens_at <= now() AND opportunity.closes_at > now()
      AND NOT EXISTS (SELECT 1 FROM unoa.job_application WHERE opportunity_id = opportunity.id AND account_id = $1) LIMIT 500`, [actor]);
  const weights: Record<string, number> = { declared: 1, taught: 2, assessed: 3, validated: 4, certified: 5 };
  return rows.map(offer => {
    const matched = skills.filter(skill => offer.competencies.includes(skill.competency_id));
    const reasons = matched.map(skill => `${skill.label} (${levelLabels[skill.level].toLowerCase()})`);
    let score = matched.reduce((sum, skill) => sum + weights[skill.level], 0);
    if (profile?.languages.some(language => offer.languages.includes(language))) { score += 1; reasons.push('langue commune'); }
    if (profile?.country && offer.country.toLowerCase() === profile.country.toLowerCase()) { score += 1; reasons.push('même pays'); }
    return { id: offer.id, title: offer.title, company: offer.company, kind: offer.kind, score, reasons, matched: matched.length };
  }).filter(item => item.matched > 0).sort((a, b) => b.score - a.score).slice(0, 10);
}

export async function careerSpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const data = await profileOf(store, actor);
  const [cvs, consents, access, favorites, alerts, applications, competencies, companies] = await Promise.all([
    store.query<{ id: string; version: number; title: string; created_at: Date }>('SELECT id, version, title, created_at FROM unoa.cv_version WHERE account_id = $1 ORDER BY version DESC', [actor]),
    store.query<{ id: string; company: string; granted_at: Date; revoked_at: Date | null }>(`SELECT consent.id, company.name AS company, consent.granted_at, consent.revoked_at FROM unoa.career_consent AS consent
      JOIN unoa.company ON company.id = consent.company_id WHERE consent.account_id = $1 ORDER BY consent.granted_at DESC`, [actor]),
    store.query<{ company: string; recruiter: string | null; resource: string; created_at: Date }>(`SELECT company.name AS company, account.display_name AS recruiter, access.resource, access.created_at
      FROM unoa.recruiter_access AS access JOIN unoa.company ON company.id = access.company_id JOIN unoa.account ON account.id = access.recruiter_id
      WHERE access.account_id = $1 ORDER BY access.created_at DESC LIMIT 100`, [actor]),
    store.query<{ id: string; title: string; company: string; closes_at: Date }>(`SELECT opportunity.id, opportunity.title, company.name AS company, opportunity.closes_at FROM unoa.job_favorite AS favorite
      JOIN unoa.opportunity ON opportunity.id = favorite.opportunity_id JOIN unoa.company ON company.id = opportunity.company_id WHERE favorite.account_id = $1 ORDER BY opportunity.closes_at`, [actor]),
    store.query<{ id: string; label: string; kind: string | null; country: string | null; language: string | null; keywords: string | null }>(
      'SELECT id, label, kind, country, language, keywords FROM unoa.job_alert WHERE account_id = $1 AND removed_at IS NULL ORDER BY created_at', [actor]),
    store.query<{ id: string; title: string; company: string; state: string; submitted_at: Date; events: { state: string; note: string | null; at: string }[];
      interviews: { id: string; starts_at: string; mode: string; place: string | null; state: string }[] }>(`
      SELECT application.id, opportunity.title, company.name AS company, application.state, application.submitted_at,
        coalesce((SELECT jsonb_agg(jsonb_build_object('state', event.state, 'note', event.note, 'at', event.created_at) ORDER BY event.created_at) FROM unoa.job_application_event AS event
          WHERE event.application_id = application.id), '[]') AS events,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id', interview.id, 'starts_at', interview.starts_at, 'mode', interview.mode, 'place', interview.place, 'state', interview.state)
          ORDER BY interview.starts_at) FROM unoa.interview WHERE interview.application_id = application.id), '[]') AS interviews
      FROM unoa.job_application AS application JOIN unoa.opportunity ON opportunity.id = application.opportunity_id JOIN unoa.company ON company.id = opportunity.company_id
      WHERE application.account_id = $1 ORDER BY application.submitted_at DESC`, [actor]),
    store.query<{ id: string; label: string }>('SELECT id, label FROM unoa.competency ORDER BY label LIMIT 500'),
    store.query<{ id: string; name: string }>("SELECT id, name FROM unoa.company WHERE state = 'approved' ORDER BY name LIMIT 500"),
  ]);
  return { ...data, cvs: cvs.rows, consents: consents.rows, access: access.rows, favorites: favorites.rows, alerts: alerts.rows, applications: applications.rows,
    competencies: competencies.rows, companies: companies.rows, suggestions: await suggestions(store, actor, data.skills, data.profile) };
}

// CAR-010: portable export of the person's own data.
export async function careerExport(settings: IamSettings, actor: string) {
  const store = database(settings);
  const data = await profileOf(store, actor);
  const { rows: applications } = await store.query('SELECT opportunity.title, application.state, application.submitted_at FROM unoa.job_application AS application JOIN unoa.opportunity ON opportunity.id = application.opportunity_id WHERE application.account_id = $1', [actor]);
  const { rows: cvs } = await store.query('SELECT version, title, content, sha256, created_at FROM unoa.cv_version WHERE account_id = $1 ORDER BY version', [actor]);
  return { format: 'unoa-career/1', exportedAt: new Date().toISOString(), ...data, cvs, applications };
}

export async function cvFile(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows: [cv] } = await store.query<{ account_id: string; title: string; version: number; pdf: Buffer }>('SELECT account_id, title, version, pdf FROM unoa.cv_version WHERE id = $1', [uuid(id)]);
  ensure(cv, 404, 'CV introuvable');
  if (cv.account_id !== actor) {
    // A recruiter reads a CV attached to an application to their company.
    const { rows: [link] } = await store.query<{ company_id: string }>(`SELECT opportunity.company_id FROM unoa.job_application AS application JOIN unoa.opportunity ON opportunity.id = application.opportunity_id
      JOIN unoa.company_member AS member ON member.company_id = opportunity.company_id AND member.account_id = $2 AND member.role IN ('owner', 'recruiter') AND member.removed_at IS NULL
      WHERE application.cv_version_id = $1 AND application.state <> 'withdrawn' LIMIT 1`, [uuid(id), actor]);
    ensure(link, 403, 'CV inaccessible');
    await logAccess(store, cv.account_id, link.company_id, actor, 'cv');
  }
  return cv;
}

// CAR-008/009: a company member reads a profile only with an active consent; each reading is logged.
export async function sharedProfile(settings: IamSettings, actor: string, accountId: string, companyId: string) {
  const store = database(settings);
  await recruiter(store, actor, uuid(companyId));
  const { rows: [consent] } = await store.query('SELECT 1 FROM unoa.career_consent WHERE account_id = $1 AND company_id = $2 AND revoked_at IS NULL', [uuid(accountId), companyId]);
  ensure(consent, 403, 'Aucun accord de partage de cette personne avec votre entreprise');
  await logAccess(store, accountId, companyId, actor, 'profile');
  return shareable(await profileOf(store, accountId));
}

export async function recruitingSpace(settings: IamSettings, actor: string) {
  const store = database(settings);
  const { rows: companies } = await store.query<{ id: string; name: string; state: string; country: string }>(`SELECT company.id, company.name, company.state, company.country FROM unoa.company
    JOIN unoa.company_member AS member ON member.company_id = company.id AND member.account_id = $1 AND member.role IN ('owner', 'recruiter') AND member.removed_at IS NULL ORDER BY company.name`, [actor]);
  const result = [];
  for (const company of companies) {
    const [offers, consents] = await Promise.all([
      store.query<{ id: string; title: string; kind: string; state: string; closes_at: Date; risk_flags: string[]; moderation_note: string | null;
        applications: { id: string; name: string | null; state: string; submitted_at: string }[] }>(`
        SELECT opportunity.id, opportunity.title, opportunity.kind, opportunity.state, opportunity.closes_at, opportunity.risk_flags, opportunity.moderation_note,
          coalesce((SELECT jsonb_agg(jsonb_build_object('id', application.id, 'name', CASE WHEN application.state = 'withdrawn' THEN NULL ELSE account.display_name END,
            'state', application.state, 'submitted_at', application.submitted_at) ORDER BY application.submitted_at)
            FROM unoa.job_application AS application JOIN unoa.account ON account.id = application.account_id WHERE application.opportunity_id = opportunity.id), '[]') AS applications
        FROM unoa.opportunity WHERE opportunity.company_id = $1 ORDER BY opportunity.created_at DESC`, [company.id]),
      store.query<{ account_id: string; name: string | null; granted_at: Date }>(`SELECT consent.account_id, account.display_name AS name, consent.granted_at FROM unoa.career_consent AS consent
        JOIN unoa.account ON account.id = consent.account_id WHERE consent.company_id = $1 AND consent.revoked_at IS NULL ORDER BY consent.granted_at DESC`, [company.id]),
    ]);
    result.push({ ...company, offers: offers.rows, consents: consents.rows });
  }
  const { rows: competencies } = await store.query<{ id: string; label: string }>('SELECT id, label FROM unoa.competency ORDER BY label LIMIT 500');
  return { companies: result, competencies };
}

export async function applicationDetail(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const application = await applicationOf(store, id);
  const own = application.account_id === actor;
  if (!own) {
    await recruiter(store, actor, application.company_id);
    await logAccess(store, application.account_id, application.company_id, actor, 'application');
  }
  const [row, documents, events, interviews] = await Promise.all([
    store.query<{ snapshot: Record<string, unknown>; snapshot_sha256: string; letter: string | null; cv_version_id: string | null; submitted_at: Date; consent_statement: string }>(
      'SELECT snapshot, snapshot_sha256, letter, cv_version_id, submitted_at, consent_statement FROM unoa.job_application WHERE id = $1', [application.id]),
    store.query<{ id: string; kind: string; filename: string; purged: boolean }>('SELECT id, kind, filename, purged_at IS NOT NULL AS purged FROM unoa.job_application_document WHERE application_id = $1', [application.id]),
    store.query<{ state: string; note: string | null; created_at: Date }>('SELECT state, note, created_at FROM unoa.job_application_event WHERE application_id = $1 ORDER BY created_at', [application.id]),
    store.query<{ id: string; starts_at: Date; duration_minutes: number; mode: string; place: string | null; state: string }>(
      'SELECT id, starts_at, duration_minutes, mode, place, state FROM unoa.interview WHERE application_id = $1 ORDER BY starts_at', [application.id]),
  ]);
  return { application, own, ...row.rows[0], documents: documents.rows, events: events.rows, interviews: interviews.rows };
}

export async function applicationDocument(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows: [document] } = await store.query<{ application_id: string; filename: string; content: Buffer | null }>('SELECT application_id, filename, content FROM unoa.job_application_document WHERE id = $1', [uuid(id)]);
  ensure(document, 404, 'Pièce introuvable');
  const application = await applicationOf(store, document.application_id);
  if (application.account_id !== actor) {
    await recruiter(store, actor, application.company_id);
    await logAccess(store, application.account_id, application.company_id, actor, 'document');
  }
  ensure(document.content, 410, 'Pièce effacée après le retrait de la candidature');
  return document as { application_id: string; filename: string; content: Buffer };
}

// Staff: moderation queue, reports, anonymised insertion statistics (JOB-012: counts under 5 hidden).
export async function jobsOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const { rows: [allowed] } = await store.query<{ read: boolean; verify: boolean; manage: boolean }>(`SELECT unoa.has_scope_permission($1, 'ent.read', $2) AS read,
    unoa.has_scope_permission($1, 'ent.verify', $2) AS verify, unoa.has_scope_permission($1, 'ent.manage', $2) AS manage`, [actor, scopeId]);
  ensure(allowed?.read, 403, 'Vue réservée aux responsables des entreprises partenaires');
  const [offers, reports, stats] = await Promise.all([
    store.query<{ id: string; title: string; company: string; kind: string; state: string; risk_flags: string[]; created_by: string; moderation_note: string | null }>(`
      SELECT opportunity.id, opportunity.title, company.name AS company, opportunity.kind, opportunity.state, opportunity.risk_flags, opportunity.created_by, opportunity.moderation_note
      FROM unoa.opportunity JOIN unoa.company ON company.id = opportunity.company_id WHERE unoa.scope_within(company.scope_id, $1)
      ORDER BY opportunity.state = 'review' DESC, opportunity.created_at DESC LIMIT 300`, [scopeId]),
    store.query<{ id: string; title: string; reason: string; state: string; outcome: string | null }>(`SELECT report.id, opportunity.title, report.reason, report.state, report.outcome
      FROM unoa.opportunity_report AS report JOIN unoa.opportunity ON opportunity.id = report.opportunity_id JOIN unoa.company ON company.id = opportunity.company_id
      WHERE unoa.scope_within(company.scope_id, $1) ORDER BY report.state, report.created_at DESC LIMIT 200`, [scopeId]),
    store.query<{ kind: string; country: string; offers: number; applications: number; offers_made: number }>(`
      SELECT opportunity.kind, opportunity.country, count(DISTINCT opportunity.id)::int AS offers, count(application.id)::int AS applications,
        count(application.id) FILTER (WHERE application.state = 'offer')::int AS offers_made
      FROM unoa.opportunity JOIN unoa.company ON company.id = opportunity.company_id LEFT JOIN unoa.job_application AS application ON application.opportunity_id = opportunity.id
      WHERE unoa.scope_within(company.scope_id, $1) GROUP BY opportunity.kind, opportunity.country ORDER BY opportunity.country, opportunity.kind`, [scopeId]),
  ]);
  const hide = (value: number) => value > 0 && value < 5 ? null : value;
  return { rights: allowed, offers: offers.rows.map(item => ({ ...item, own: item.created_by === actor })), reports: reports.rows,
    statistics: stats.rows.map(row => ({ ...row, applications: hide(row.applications), offers_made: hide(row.offers_made) })) };
}

// Referential: competencies, courses and the teacher's assessments to link (CAR-001/002).
export async function referential(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [competencies, courses, assessments] = await Promise.all([
    store.query<{ id: string; code: string; label: string; scope: string; labels: { language: string; label: string }[]; editable: boolean }>(`
      SELECT competency.id, competency.code, competency.label, scope.label AS scope, unoa.has_scope_permission($1, 'catalog.write', competency.owner_scope_id) AS editable,
        coalesce((SELECT jsonb_agg(jsonb_build_object('language', item.language, 'label', item.label) ORDER BY item.language) FROM unoa.competency_label AS item WHERE item.competency_id = competency.id), '[]') AS labels
      FROM unoa.competency JOIN unoa.scope ON scope.id = competency.owner_scope_id ORDER BY competency.label LIMIT 500`, [actor]),
    store.query<{ id: string; code: string; title: string; linked: string[] }>(`SELECT course.id, course.code, course.title,
        coalesce((SELECT array_agg(competency_id) FROM unoa.course_competency WHERE course_id = course.id), '{}') AS linked
      FROM unoa.course WHERE unoa.has_scope_permission($1, 'catalog.write', course.owner_scope_id) ORDER BY course.code LIMIT 300`, [actor]),
    store.query<{ id: string; title: string; offering: string; linked: string[] }>(`SELECT assessment.id, assessment.title, offering.label AS offering,
        coalesce((SELECT array_agg(competency_id) FROM unoa.assessment_competency WHERE assessment_id = assessment.id), '{}') AS linked
      FROM unoa.assessment JOIN unoa.course_offering AS offering ON offering.id = assessment.offering_id
      JOIN unoa.offering_member AS member ON member.offering_id = offering.id AND member.account_id = $1 AND member.role = 'teacher' AND member.removed_at IS NULL
      ORDER BY assessment.title LIMIT 300`, [actor]),
  ]);
  return { competencies: competencies.rows, courses: courses.rows, assessments: assessments.rows };
}
