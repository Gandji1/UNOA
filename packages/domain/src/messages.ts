// Catalogue of the events the software emits, with the default wording used
// when no template has been published by the administration. Templates are
// plain text with {{variable}} placeholders; nothing is evaluated.

export type Channel = 'internal' | 'email' | 'sms';
export interface EventDefinition {
  code: string; module: string; variables: string[]; sensitive: boolean;
  defaults: Record<'fr' | 'en', { subject: string; body: string }>;
}

export const events: EventDefinition[] = [
  { code: 'adm.receipt', module: 'ADM', variables: ['program', 'receipt', 'revision'], sensitive: false, defaults: {
    fr: { subject: 'Accusé de réception · {{receipt}}', body: '{{program}} — dossier déposé (version {{revision}}).' },
    en: { subject: 'Acknowledgement · {{receipt}}', body: '{{program}} — application submitted (version {{revision}}).' } } },
  { code: 'adm.complement', module: 'ADM', variables: ['program', 'message'], sensitive: true, defaults: {
    fr: { subject: 'Complément demandé', body: '{{message}}' }, en: { subject: 'Additional information requested', body: '{{message}}' } } },
  { code: 'adm.interview', module: 'ADM', variables: ['program', 'kind', 'place'], sensitive: false, defaults: {
    fr: { subject: 'Convocation : {{kind}}', body: '{{place}}' }, en: { subject: 'Invitation: {{kind}}', body: '{{place}}' } } },
  { code: 'adm.decision', module: 'ADM', variables: ['program'], sensitive: true, defaults: {
    fr: { subject: 'Décision sur votre candidature', body: '{{program}}' }, en: { subject: 'Decision on your application', body: '{{program}}' } } },
  { code: 'adm.appeal_ruled', module: 'ADM', variables: ['program', 'outcome'], sensitive: true, defaults: {
    fr: { subject: 'Réponse à votre recours', body: '{{outcome}}' }, en: { subject: 'Response to your appeal', body: '{{outcome}}' } } },
  { code: 'live.scheduled', module: 'LIVE', variables: ['title', 'start', 'recording'], sensitive: false, defaults: {
    fr: { subject: 'Séance planifiée : {{title}}', body: '{{start}}{{recording}}' }, en: { subject: 'Session scheduled: {{title}}', body: '{{start}}{{recording}}' } } },
  { code: 'live.rescheduled', module: 'LIVE', variables: ['title', 'start', 'reason'], sensitive: false, defaults: {
    fr: { subject: 'Séance reportée : {{title}}', body: 'Nouvel horaire : {{start}}. {{reason}}' }, en: { subject: 'Session moved: {{title}}', body: 'New time: {{start}}. {{reason}}' } } },
  { code: 'live.cancelled', module: 'LIVE', variables: ['title', 'reason'], sensitive: false, defaults: {
    fr: { subject: 'Séance annulée : {{title}}', body: '{{reason}}' }, en: { subject: 'Session cancelled: {{title}}', body: '{{reason}}' } } },
  { code: 'live.recording', module: 'LIVE', variables: ['title'], sensitive: false, defaults: {
    fr: { subject: 'Enregistrement annoncé : {{title}}', body: 'Indiquez votre consentement avant la séance.' },
    en: { subject: 'Recording announced: {{title}}', body: 'Please record your consent before the session.' } } },
  { code: 'live.replay', module: 'LIVE', variables: ['title'], sensitive: false, defaults: {
    fr: { subject: 'Replay disponible : {{title}}', body: '' }, en: { subject: 'Replay available: {{title}}', body: '' } } },
  { code: 'sis.registration_validated', module: 'SIS', variables: ['program', 'matricule', 'year'], sensitive: false, defaults: {
    fr: { subject: 'Inscription validée · {{year}}', body: '{{program}} — matricule {{matricule}}.' },
    en: { subject: 'Registration confirmed · {{year}}', body: '{{program}} — student number {{matricule}}.' } } },
  { code: 'sis.status_changed', module: 'SIS', variables: ['status', 'reason'], sensitive: true, defaults: {
    fr: { subject: 'Changement de votre situation', body: '{{status}} — {{reason}}' },
    en: { subject: 'Change to your student status', body: '{{status}} — {{reason}}' } } },
  { code: 'gov.convened', module: 'GOV', variables: ['council', 'title', 'start'], sensitive: false, defaults: {
    fr: { subject: 'Convocation · {{council}}', body: '{{title}} — {{start}}' }, en: { subject: 'Notice of meeting · {{council}}', body: '{{title}} — {{start}}' } } },
  { code: 'gov.agenda_changed', module: 'GOV', variables: ['council', 'title', 'version'], sensitive: false, defaults: {
    fr: { subject: 'Ordre du jour modifié · {{council}}', body: '{{title}} — version {{version}}' }, en: { subject: 'Agenda updated · {{council}}', body: '{{title}} — version {{version}}' } } },
  { code: 'gov.minutes_signed', module: 'GOV', variables: ['council', 'title'], sensitive: false, defaults: {
    fr: { subject: 'Procès-verbal signé · {{council}}', body: '{{title}}' }, en: { subject: 'Minutes signed · {{council}}', body: '{{title}}' } } },
  { code: 'tea.application_decided', module: 'TEA', variables: ['title'], sensitive: true, defaults: {
    fr: { subject: 'Décision sur votre candidature enseignante', body: '{{title}}' }, en: { subject: 'Decision on your teaching application', body: '{{title}}' } } },
  { code: 'tea.contract_ready', module: 'TEA', variables: ['scope', 'function'], sensitive: false, defaults: {
    fr: { subject: 'Contrat à signer · {{scope}}', body: 'Mission : {{function}}' }, en: { subject: 'Contract to sign · {{scope}}', body: 'Assignment: {{function}}' } } },
  { code: 'tea.assigned', module: 'TEA', variables: ['course', 'function'], sensitive: false, defaults: {
    fr: { subject: 'Nouvelle affectation : {{course}}', body: 'Fonction : {{function}}' }, en: { subject: 'New assignment: {{course}}', body: 'Function: {{function}}' } } },
  { code: 'ass.published', module: 'ASS', variables: ['title', 'course', 'opens', 'closes'], sensitive: false, defaults: {
    fr: { subject: 'Nouvelle évaluation : {{title}}', body: '{{course}} — du {{opens}} au {{closes}}' }, en: { subject: 'New assessment: {{title}}', body: '{{course}} — {{opens}} to {{closes}}' } } },
  { code: 'ass.receipt', module: 'ASS', variables: ['title', 'receipt'], sensitive: false, defaults: {
    fr: { subject: 'Copie reçue · {{title}}', body: 'Accusé de réception : {{receipt}}' }, en: { subject: 'Submission received · {{title}}', body: 'Receipt: {{receipt}}' } } },
  { code: 'ass.graded', module: 'ASS', variables: ['title'], sensitive: false, defaults: {
    fr: { subject: 'Copie corrigée · {{title}}', body: 'Consultez la correction et les commentaires.' }, en: { subject: 'Submission graded · {{title}}', body: 'See the grading and feedback.' } } },
  { code: 'ass.integrity', module: 'ASS', variables: ['title'], sensitive: true, defaults: {
    fr: { subject: 'Procédure relative à votre copie', body: '{{title}} — vous pouvez présenter vos observations.' }, en: { subject: 'Procedure concerning your submission', body: '{{title}} — you may respond.' } } },
  { code: 'grd.results_published', module: 'GRD', variables: ['jury', 'period'], sensitive: false, defaults: {
    fr: { subject: 'Résultats publiés · {{period}}', body: '{{jury}} — consultez vos résultats et votre relevé.' }, en: { subject: 'Results published · {{period}}', body: '{{jury}} — see your results and transcript.' } } },
  { code: 'grd.appeal_decided', module: 'GRD', variables: ['jury', 'outcome'], sensitive: true, defaults: {
    fr: { subject: 'Réponse à votre contestation', body: '{{jury}} : {{outcome}}' }, en: { subject: 'Answer to your appeal', body: '{{jury}}: {{outcome}}' } } },
  { code: 'grd.rectified', module: 'GRD', variables: ['jury'], sensitive: true, defaults: {
    fr: { subject: 'Rectification de vos résultats', body: '{{jury}} — un avenant modifie votre résultat.' }, en: { subject: 'Results rectified', body: '{{jury}} — an amendment changes your result.' } } },
  { code: 'exn.verified', module: 'EXN', variables: ['exam', 'state'], sensitive: true, defaults: {
    fr: { subject: 'Vérification de votre pièce officielle', body: '{{exam}} : {{state}}' }, en: { subject: 'Verification of your official document', body: '{{exam}}: {{state}}' } } },
];

// Generic wording sent outside the platform for a sensitive event.
export const sensitiveNotice = {
  fr: { subject: 'Nouvelle notification', body: 'Une information vous attend dans votre espace.' },
  en: { subject: 'New notification', body: 'Information is waiting in your space.' },
};

export class TemplateError extends Error {}

const placeholder = /\{\{\s*([a-z][a-z0-9_]{0,40})\s*\}\}/g;

export function eventOf(code: string) {
  return events.find(item => item.code === code);
}

// Validates a template against the variables declared for its event.
export function checkTemplate(text: string, variables: string[], limit: number) {
  if (text.length > limit || text.includes('\u0000')) throw new TemplateError('Texte trop long');
  if (/<\s*[a-z!/]/i.test(text)) throw new TemplateError('Le balisage HTML est refusé');
  const stray = text.replace(placeholder, '').match(/\{\{|\}\}/);
  if (stray) throw new TemplateError('Variable mal formée');
  for (const match of text.matchAll(placeholder)) {
    if (!variables.includes(match[1])) throw new TemplateError('Variable inconnue : ' + match[1]);
  }
  return text;
}

// Plain-text rendering: values are inserted as text, control characters dropped.
export function render(text: string, values: Record<string, string | null | undefined>) {
  return text.replace(placeholder, (_, name: string) => String(values[name] ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '')).trim();
}

export function language(preferred: string | null | undefined): 'fr' | 'en' {
  return preferred?.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

// Masks a recipient for the delivery log: a@b.org → a***@b.org ; +2290100 → +229****00
export function maskRecipient(value: string) {
  if (value.includes('@')) {
    const [name, domain] = value.split('@');
    return name.slice(0, 1) + '***@' + domain;
  }
  return value.slice(0, 4) + '****' + value.slice(-2);
}

export function backoffMinutes(attempt: number) {
  return Math.min(2 ** Math.max(attempt - 1, 0), 60);
}
