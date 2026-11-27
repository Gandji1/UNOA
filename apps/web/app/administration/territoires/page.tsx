import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { readableTerritories, scopeTypeCatalogue, territoryDetails } from '@/lib/territory/store';
import { Problem } from '@/lib/shared/validation';
import {
  AttachmentClosure, AttachmentEditor, ChildEditor, formatTime, isEstablishment,
  kindLabels, LabelEditor, natureLabels, TerritoryEditor, TypeEditor,
} from './components';

export const metadata: Metadata = { title: 'Pays et établissements' };
export const dynamic = 'force-dynamic';

const path = '/administration/territoires';
const formErrors: Record<string, string> = {
  '400': 'Vérifiez les champs saisis : fuseau IANA, monnaie, langue et format régional.',
  '403': 'Cette action dépasse vos habilitations.',
  '404': 'Le périmètre demandé est introuvable.',
  '409': 'Cet enregistrement existe déjà ou a changé depuis son affichage.',
  '413': 'La demande dépasse la taille autorisée.',
  '422': 'La hiérarchie, la période de présence ou la nature du périmètre refuse cette valeur.',
  '503': 'Le registre territorial est temporairement indisponible.',
};

type Search = Record<string, string | string[] | undefined>;
const stringField = (value: Search[string]) => typeof value === 'string' ? value : '';
const isScope = (value: string) => scopeIdFormat.test(value);
const studioUrl = (fields: Record<string, string>) => path + '?' + new URLSearchParams(fields).toString();

export default async function Territoires({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const token = (await cookies()).get(cookieName(settings, 'session'))?.value;
  const actor = await sessionAccount(settings, token).catch(() => null);
  if (!actor) redirect('/connexion');

  const search = await searchParams;
  const scopeAfter = stringField(search.scopeAfter);
  const childAfter = stringField(search.childAfter);
  const scopes = await readableTerritories(settings, actor, isScope(scopeAfter) ? scopeAfter : undefined);
  const options = scopes.slice(0, 50);
  const selected = stringField(search.scope);
  const selectedId = isScope(selected) ? selected : options[0]?.id;
  const message = formErrors[stringField(search.error)];

  if (!selectedId) {
    return (
      <main id="contenu">
        <a href="/espace">Mon espace</a>
        <section className="account-panel">
          <h1>Pays et établissements</h1>
          <p>{scopeAfter ? 'Aucun autre périmètre à afficher.' : 'Aucun périmètre territoriale ne vous est attribuée.'}</p>
          {scopeAfter && <p><a href={path}>Revenir aux premiers périmètres</a></p>}
        </section>
      </main>
    );
  }

  const data = await territoryDetails(settings, actor, selectedId, isScope(childAfter) ? childAfter : undefined)
    .catch(error => {
      if (error instanceof Problem && [403, 404].includes(error.status)) return null;
      throw error;
    });
  if (!data) {
    return (
      <main id="contenu">
        <section className="account-panel">
          <h1>Pays et établissements</h1>
          <p>Ce périmètre est inaccessible.</p>
          <p><a href={path}>Choisir un périmètre autorisé</a></p>
        </section>
      </main>
    );
  }

  const { scope, children, labels, attachments, hosted } = data;
  const choices = options.some(option => option.id === scope.id) ? options : [scope, ...options];
  const types = await scopeTypeCatalogue(settings);
  const targets = options.filter(option =>
    option.id !== scope.id && (option.nature === 'territory' || option.nature === 'jurisdiction'));

  return (
    <main id="contenu" className="studio">
      <a href="/espace">Mon espace</a>
      <section className="studio-heading">
        <h1>Pays et établissements</h1>
        <p>Déclarez les types, la hiérarchie, les règles régionales et les rattachements des établissements.</p>
      </section>

      {message && <p className="studio-notice" role="alert">{message}</p>}
      {!message && search.message === 'saved' && <p className="studio-notice" role="status">Modification enregistrée.</p>}

      <section className="studio-panel" aria-label="Choix du périmètre">
        <form method="get" className="studio-form studio-filters">
          <label>Périmètre<select name="scope" defaultValue={scope.id}>
            {choices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select></label>
          <button type="submit" className="action">Consulter</button>
        </form>
        <div className="studio-links">
          {scopes.length > 50 && <a href={studioUrl({ scopeAfter: options[49].id })}>Périmètres suivantes</a>}
          {scopeAfter && <a href={path}>Premières périmètres</a>}
        </div>
      </section>

      <section className="studio-panel" aria-labelledby="identite-title">
        <h2 id="identite-title">{scope.label}</h2>
        <dl className="studio-resolution">
          <div><dt>Type</dt><dd>{scope.type_label}</dd></div>
          <div><dt>Nature</dt><dd>{natureLabels[scope.nature]}</dd></div>
          <div><dt>Périmètre mère</dt><dd>{scope.parent_label ?? 'Racine de la plateforme'}</dd></div>
          <div><dt>Fuseau</dt><dd>{scope.time_zone ?? 'Non renseigné'}</dd></div>
          <div><dt>Monnaie</dt><dd>{scope.currency ?? 'Non renseignée'}</dd></div>
          <div><dt>Format régional</dt><dd>{scope.locale ?? 'Non renseigné'}</dd></div>
          <div><dt>Présence</dt><dd>{formatTime(scope.present_from)} → {formatTime(scope.present_until)}</dd></div>
        </dl>
        {isEstablishment(scope) && (
          <dl className="studio-resolution">
            <div><dt>Identité légale</dt><dd>{scope.legal_name ?? 'Non publiée'}</dd></div>
            <div><dt>Contacts</dt><dd>{scope.contact ?? 'Non publiés'}</dd></div>
          </dl>
        )}
      </section>

      <section className="studio-panel" aria-labelledby="designations-title">
        <h2 id="designations-title">Désignations traduites</h2>
        {labels.length === 0 ? <p>Aucune traduction enregistrée. Le libellé de travail reste affiché.</p> : (
          <div className="studio-table" role="region" aria-label="Désignations traduites" tabIndex={0}>
            <table>
              <thead><tr><th>Langue</th><th>Désignation</th><th>Mise à jour</th></tr></thead>
              <tbody>{labels.map(item => (
                <tr key={item.language}>
                  <td>{item.language}</td><td>{item.label}</td><td>{formatTime(item.updated_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {scope.write && <LabelEditor scope={scope} />}
      </section>

      <section className="studio-panel" aria-labelledby="sous-portees-title">
        <h2 id="sous-portees-title">Sous-périmètres</h2>
        {children.length === 0 ? <p>Aucune sous-périmètre visible.</p> : (
          <div className="studio-table" role="region" aria-label="Sous-périmètres" tabIndex={0}>
            <table>
              <thead><tr><th>Périmètre</th><th>Nature</th><th>Fuseau</th><th>Monnaie</th><th>Présence</th></tr></thead>
              <tbody>{children.map(child => (
                <tr key={child.id}>
                  <td><a href={studioUrl({ scope: child.id })}>{child.label}</a></td>
                  <td>{natureLabels[child.nature]}</td>
                  <td>{child.time_zone ?? '—'}</td>
                  <td>{child.currency ?? '—'}</td>
                  <td>{formatTime(child.present_from)} → {formatTime(child.present_until)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="studio-links">
          {data.nextChild && <a href={studioUrl({ scope: scope.id, childAfter: data.nextChild })}>Sous-périmètres suivantes</a>}
          {childAfter && <a href={studioUrl({ scope: scope.id })}>Premières sous-périmètres</a>}
        </div>
      </section>

      <section className="studio-panel" aria-labelledby="rattachements-title">
        <h2 id="rattachements-title">Rattachements</h2>
        {isEstablishment(scope) ? (
          attachments.length === 0 ? <p>Cet établissement n’est rattaché à aucun territoire ni cadre réglementaire.</p> : (
            <div className="studio-table" role="region" aria-label="Rattachements de l’établissement" tabIndex={0}>
              <table>
                <thead><tr><th>Périmètre visée</th><th>Nature</th><th>Période</th><th>Justification</th><th>Action</th></tr></thead>
                <tbody>{attachments.map(item => (
                  <tr key={item.id}>
                    <td>{item.territory_label}</td><td>{kindLabels[item.kind]}</td>
                    <td>{formatTime(item.effective_from)} → {formatTime(item.effective_until)}</td>
                    <td>{item.reason}</td>
                    <td>{item.effective_until === null && scope.write
                      ? <AttachmentClosure scope={scope} attachment={item} /> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )
        ) : (
          hosted.length === 0 ? <p>Aucun établissement rattaché à ce périmètre.</p> : (
            <div className="studio-table" role="region" aria-label="Établissements rattachés" tabIndex={0}>
              <table>
                <thead><tr><th>Établissement</th><th>Nature</th><th>Période</th><th>Justification</th></tr></thead>
                <tbody>{hosted.map(item => (
                  <tr key={item.id}>
                    <td>{item.territory_label}</td><td>{kindLabels[item.kind]}</td>
                    <td>{formatTime(item.effective_from)} → {formatTime(item.effective_until)}</td>
                    <td>{item.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )
        )}
        {scope.write && isEstablishment(scope) && targets.length > 0 && <AttachmentEditor scope={scope} targets={targets} />}
      </section>

      {scope.creates && <ChildEditor scope={scope} types={types} />}
      {scope.write && <TerritoryEditor scope={scope} />}
      {scope.root && scope.define && (stringField(search.avance) === '1' ? <TypeEditor scope={scope} types={types} />
        : <p className="muted"><a href={`${path}?scope=${scope.id}&avance=1`}>Types de niveaux (réglage avancé)</a></p>)}
    </main>
  );
}
