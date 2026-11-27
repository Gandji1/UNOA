import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { database, sessionAccount } from '@/lib/iam/sessions';
import { wizardData, wizardKinds, type WizardKind } from '@/lib/iam/wizard';
import { ActionForm, Hidden, Notice } from '../forms';
import { handoffs } from '@/lib/iam/handoff';
import { allowedCreations } from '@/lib/iam/navigation';
import { HandoffPanel } from '../handoff';

export const metadata: Metadata = { title: 'Créer' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/creer';
const code = (label: string) => <label>Code court (lettres, chiffres)<input name="code" required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,31}" placeholder="ex. FST" />
  <span className="studio-help">{label}</span></label>;

function ParentPicker({ kind, items, chosen, label }: { kind: string; items: { id: string; path: string }[]; chosen?: string; label: string }) {
  return (
    <form method="get" action={path} className="studio-inline">
      <input type="hidden" name="quoi" value={kind} />
      <label>{label}<select name="dans" defaultValue={chosen ?? ''} required>
        <option value="" disabled>Choisir…</option>{items.map(item => <option key={item.id} value={item.id}>{item.path}</option>)}</select></label>
      <button className="secondary" type="submit">Choisir</button>
    </form>
  );
}

// What logically follows each creation in the hierarchy.
const nextSteps: Record<string, [string, string][]> = {
  pays: [['Nommer l’administrateur de ce pays', '?quoi=responsable'], ['Créer un autre pays', '?quoi=pays']],
  etablissement: [['Nommer l’administrateur de cet établissement', '?quoi=responsable'], ['Créer un campus', '?quoi=campus']],
  campus: [['Nommer un responsable', '?quoi=responsable']],
  faculte: [['Créer un département dans cette faculté', '?quoi=departement'], ['Nommer le doyen', '?quoi=responsable']],
  departement: [['Nommer le chef de département', '?quoi=responsable'], ['Créer une filière', '?quoi=filiere']],
  filiere: [['Créer une formation', '?quoi=formation'], ['Créer une spécialité', '?quoi=filiere']],
  formation: [['Créer les matières', '?quoi=matiere'], ['Compléter la maquette (semestres, UE, crédits)', '/administration/catalogue']],
  matiere: [['Rédiger le cours en ligne', '/administration/cours'], ['Nommer un enseignant', '?quoi=responsable']],
  responsable: [],
};

export default async function Creer({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const kind = wizardKinds.find(item => item.kind === field(search.quoi))?.kind as WizardKind | undefined;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const { rows: [root] } = await database(settings).query<{ id: string; define: boolean }>(
    "SELECT id, unoa.has_scope_permission($1, 'territory.define', id) AND unoa.has_scope_permission($1, 'catalog.define', id) AS define FROM unoa.scope WHERE parent_id IS NULL", [actor]);

  if (!kind) {
    const allowed = new Set((await allowedCreations(actor)).map(item => item.kind));
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <span aria-current="page">Créer</span></nav>
        <section className="studio-heading"><p className="eyebrow">Assistants</p><h1>Que voulez-vous créer ?</h1>
          <p>Vous ne voyez que ce que votre fonction vous permet de créer.</p></section>
        {notice}
        {root?.define && (
          <section className="studio-panel" aria-labelledby="types">
            <h2 id="types">Avant de commencer (super-administrateur)</h2>
            <p>Les mots utilisés (Pays, Université, Campus, Faculté, Département, Filière, Spécialité, Licence, Master, Doctorat, Certificat) sont des types
              que vous pouvez créer en un clic ; ils restent modifiables dans « Pays et établissements » et « Filières et formations ».</p>
            <ActionForm inline action="/api/v1/setup/standard-types" back={path} submit="Créer les types usuels manquants" />
          </section>
        )}
        <ul className="admin-grid">
          {wizardKinds.filter(item => allowed.has(item.kind)).map(item => <li key={item.kind}><a href={`${path}?quoi=${item.kind}`}><strong>{item.title}</strong>
            <span className="muted">{item.help}</span><span className="muted"> · {item.who}</span></a></li>)}
        </ul>
      </main>
    );
  }

  const meta = wizardKinds.find(item => item.kind === kind)!;
  const data = await wizardData(settings, actor, kind, field(search.dans) || undefined);
  const back = `${path}?quoi=${kind}${data.chosen ? '&dans=' + data.chosen.id : ''}`;
  const empty = (text: string) => <p className="card-note">{text}</p>;
  let body: ReactNode = null;

  if ('types' in data) {
    const labels: Record<string, string> = { pays: 'Dans', etablissement: 'Pays', campus: 'Établissement', faculte: 'Établissement', departement: 'Faculté' };
    body = data.parents.length === 0 ? empty('Aucun emplacement où vous pouvez créer cet élément. Créez d’abord le niveau précédent ou demandez le rôle adapté.') : <>
      <ParentPicker kind={kind} items={data.parents} chosen={data.chosen?.id} label={labels[kind]} />
      {data.chosen && (data.types.length === 0 ? empty('Aucun type n’est prévu à cet endroit. Le super-administrateur crée les types usuels depuis la page « Créer ».') : (
        ['pays', 'etablissement', 'campus'].includes(kind) ? (
          <ActionForm action="/api/v1/territories/scopes" back={back} hidden={{ scopeId: data.chosen.id, parentId: data.chosen.id }} submit={meta.title}>
            <label>Type<select name="typeCode">{data.types.map(type => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
            <label className="studio-wide">Nom<input name="label" required maxLength={200} /></label>
            <label>Fuseau horaire<input name="timeZone" defaultValue="Africa/Porto-Novo" maxLength={60} /></label>
            <label>Monnaie (code ISO)<input name="currency" defaultValue="XOF" maxLength={3} pattern="[A-Z]{3}" /></label>
            <label>Langue et format<input name="locale" defaultValue="fr-BJ" maxLength={20} /></label>
          </ActionForm>
        ) : (
          <ActionForm action="/api/v1/org/units" back={back} hidden={{ parentId: data.chosen.id, public: 'true' }} submit={meta.title}
            >
            <label>Type<select name="typeCode">{data.types.map(type => <option key={type.code} value={type.code}>{type.label}</option>)}</select></label>
            <label className="studio-wide">Nom<input name="label" required maxLength={200} placeholder={kind === 'faculte' ? 'ex. Faculté des sciences et techniques' : 'ex. Département d’informatique'} /></label>
            {code('Unique dans l’établissement.')}
            <label className="studio-wide">Mission (facultatif)<textarea name="mission" maxLength={2000} /></label>
          </ActionForm>
        )))}
      {data.mine.length > 0 && <p className="muted">En attente de validation : {data.mine.map(item => item.label).join(', ')}.</p>}
      {data.pending.length > 0 && (
        <section className="studio-panel" aria-labelledby="valider"><h2 id="valider">À valider par vous</h2>
          <ul>{data.pending.map(item => <li key={item.id}>{item.type_label} « {item.label} » dans {item.parent_label}{' '}
            <ActionForm inline action={`/api/v1/org/units/${item.id}/decide`} back={back} hidden={{ decision: 'approve' }} submit="Valider" />
            <ActionForm inline action={`/api/v1/org/units/${item.id}/decide`} back={back} hidden={{ decision: 'reject' }} submit="Refuser">
              <input name="note" required maxLength={500} placeholder="Motif" aria-label="Motif du refus" /></ActionForm></li>)}</ul>
        </section>
      )}
    </>;
  } else if ('owners' in data) {
    body = data.owners.length === 0 ? empty('Aucun établissement, faculté ou département où vous pouvez créer cet élément.') : <>
      <ParentPicker kind={kind} items={data.owners} chosen={data.chosen?.id} label="Rattaché à" />
      {data.chosen && kind === 'filiere' && (data.fieldTypes.length === 0 ? empty('Aucun type de filière déclaré : le super-administrateur crée les types usuels depuis la page « Créer ».') : (
        <ActionForm action="/api/v1/catalog/fields" back={back} hidden={{ scopeId: data.chosen.id }} submit="Créer">
          <label>Type<select name="typeCode">{data.fieldTypes.map(type => <option key={type.code} value={type.code}>{type.label}{type.root_allowed ? '' : ' (dans ' + type.parents.join(', ') + ')'}</option>)}</select></label>
          <label>Au sein de (pour une spécialité)<select name="parentId"><option value="">—</option>{data.fields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="studio-wide">Nom<input name="label" required maxLength={200} placeholder="ex. Informatique" /></label>
          {code('Unique dans l’établissement.')}
        </ActionForm>
      ))}
      {data.chosen && kind === 'formation' && (data.programKinds.length === 0 ? empty('Aucune nature de formation déclarée : le super-administrateur crée les types usuels.') : (
        <ActionForm action="/api/v1/catalog/programs" back={back} hidden={{ scopeId: data.chosen.id, languages: 'fr' }} submit="Créer la formation"
          confirm="La maquette (semestres, unités d’enseignement, crédits) se complète ensuite dans « Filières et formations » ; la publication revient à une autre personne.">
          <label>Nature<select name="kindCode">{data.programKinds.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          <label>Filière ou spécialité<select name="fieldId"><option value="">—</option>{data.fields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="studio-wide">Intitulé<input name="title" required maxLength={200} placeholder="ex. Licence d’informatique" /></label>
          {code('ex. L-INFO')}
          <label>Organisation<input name="organisation" required maxLength={120} defaultValue="Semestrielle" /></label>
          <label>Durée<input name="duration" required maxLength={120} defaultValue="6 semestres" /></label>
          <label>Modalité<input name="deliveryMode" required maxLength={120} defaultValue="À distance" /></label>
          <label>Unité de crédits<input name="creditUnit" required maxLength={60} defaultValue="crédits ECTS" /></label>
          <label>Crédits attendus<input name="expectedCredits" type="number" min={1} defaultValue={180} /></label>
        </ActionForm>
      ))}
      {data.chosen && kind === 'matiere' && (
        <ActionForm action="/api/v1/catalog/courses" back={back} hidden={{ scopeId: data.chosen.id }} submit="Créer la matière"
          confirm="Elle se rattache ensuite à une unité d’enseignement de la maquette ; son contenu en ligne se rédige dans « Cours en ligne ».">
          <label className="studio-wide">Intitulé<input name="title" required maxLength={200} placeholder="ex. Algorithmique" /></label>
          {code('ex. ALGO1')}
        </ActionForm>
      )}
    </>;
  } else {
    body = data.scopes.length === 0 ? empty('Vous ne pouvez nommer personne.') : <>
      <ParentPicker kind={kind} items={data.scopes} chosen={data.chosen?.id} label="Sur" />
      {data.chosen && (data.roles.length === 0 ? empty('Aucun rôle que vous pouvez attribuer à cet endroit.') : (
        <form method="post" action="/api/v1/iam/invitations" className="studio-form">
          <Hidden values={{ scopeId: data.chosen.id, includeDescendants: 'true', validDays: '7', reason: 'Nomination depuis l’assistant' }} />
          <label className="studio-wide">Rôle<select name="role">{data.roles.map(role => <option key={role.code} value={role.code}>{role.label ?? role.code}</option>)}</select></label>
          <label>Nom complet<input name="displayName" required maxLength={200} /></label>
          <label>Courriel (facultatif)<input name="email" type="email" maxLength={254} /></label>
          <p className="studio-wide studio-help">Un lien personnel est créé : transmettez-le à la personne, qui choisit son identifiant et son mot de passe.</p>
          <div className="studio-wide"><button className="action" type="submit">Créer l’invitation</button></div>
        </form>
      ))}
    </>;
  }

  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <a href={path}>Créer</a> › <span aria-current="page">{meta.title}</span></nav>
      <section className="studio-heading"><p className="eyebrow">Assistant · {meta.who}</p><h1>{meta.title}</h1><p>{meta.help}</p></section>
      {notice}
      {field(search.message) === 'saved' && nextSteps[kind].length > 0 && (
        <section className="studio-panel" aria-labelledby="suite"><h2 id="suite">C’est fait. Étape suivante</h2>
          <p className="studio-actions">{nextSteps[kind].map(([label, href]) => <a key={label} className="action" href={href.startsWith('?') ? path + href : href}>{label}</a>)}</p></section>
      )}
      {field(search.message) === 'saved' && <HandoffPanel items={(await handoffs(settings, actor)).slice(0, 3)} tasks={[]} />}
      {body}
      <p><a href={path}>← Autres créations</a></p>
    </main>
  );
}
