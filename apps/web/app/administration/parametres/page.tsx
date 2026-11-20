import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { catalogue, configurationDetails, readableScopes, scopeTypes } from '@/lib/config/store';
import { configKey } from '@/lib/config/validation';
import { Problem, utcTime } from '@/lib/shared/validation';
import { DefinitionEditor, DraftEditor, formatTime, formatValue, kindLabels, stateLabels, VersionAction } from './components';

export const metadata: Metadata = { title: 'Paramètres et versions · UNOA' };
export const dynamic = 'force-dynamic';

const path = '/administration/parametres';
const formErrors: Record<string, string> = {
  '400': 'Vérifiez les champs saisis.',
  '403': 'Cette action dépasse vos habilitations.',
  '404': 'La version demandée est introuvable.',
  '409': 'La référence a changé ou la valeur existe déjà. Actualisez la prévisualisation.',
  '413': 'La demande dépasse la taille autorisée.',
  '422': 'Vérifiez la valeur, ses bornes et la date d’effet.',
  '503': 'Le service de configuration est temporairement indisponible.',
};

type Search = Record<string, string | string[] | undefined>;
const stringField = (value: Search[string]) => typeof value === 'string' ? value : '';
const isScope = (value: string) => scopeIdFormat.test(value);

function studioUrl(fields: Record<string, string>) {
  return path + '?' + new URLSearchParams(fields).toString();
}

function effectiveDate(value: string) {
  try {
    return utcTime(value);
  } catch {
    return new Date().toISOString();
  }
}

export default async function Configuration({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const userToken = (await cookies()).get(cookieName(settings, 'session'))?.value;
  const actor = await sessionAccount(settings, userToken).catch(() => null);
  if (!actor) redirect('/connexion');

  const search = await searchParams;
  const scopeAfter = stringField(search.scopeAfter);
  const keyAfter = stringField(search.keyAfter);
  const at = effectiveDate(stringField(search.at));
  const scopes = await readableScopes(settings, actor, isScope(scopeAfter) ? scopeAfter : undefined);
  const scopeOptions = scopes.slice(0, 50);
  const selected = stringField(search.scope);
  const selectedScopeId = isScope(selected) ? selected : scopeOptions[0]?.id;

  if (!selectedScopeId) {
    return (
      <main id="contenu">
        <a href="/espace">Mon espace</a>
        <section className="account-panel">
          <h1>Paramètres et versions</h1>
          <p>{scopeAfter ? 'Aucune autre portée à afficher.' : 'Aucune portée de configuration ne vous est attribuée.'}</p>
          {scopeAfter && <p><a href={path}>Revenir aux premières portées</a></p>}
        </section>
      </main>
    );
  }

  const result = await catalogue(settings, actor, selectedScopeId,
    keyAfter.length <= 96 && configKey.test(keyAfter) ? keyAfter : undefined)
      .catch(error => {
        if (error instanceof Problem && error.status === 403) return null;
        throw error;
      });
  if (!result) {
    return (
      <main id="contenu">
        <section className="account-panel">
          <h1>Paramètres et versions</h1>
          <p>Cette portée est inaccessible.</p>
          <p><a href={path}>Choisir une portée autorisée</a></p>
        </section>
      </main>
    );
  }
  const { scope, definitions } = result;
  const scopeChoices = scopeOptions.some(option => option.id === scope.id) ? scopeOptions : [scope, ...scopeOptions];
  const items = definitions.slice(0, 24);
  const key = stringField(search.key);
  const preview = stringField(search.preview);
  const before = Number(stringField(search.before));
  const historyCursor = Number.isInteger(before) && before > 0 && before <= 2_147_483_647 ? before : undefined;
  const readDetails = (parameterKey: string) =>
    configurationDetails(settings, actor, scope, parameterKey, at, isScope(preview) ? preview : undefined, historyCursor);
  let data = key.length <= 96 && configKey.test(key)
    ? await readDetails(key).catch(error => {
      if (error instanceof Problem && error.status === 404) return null;
      throw error;
    })
    : null;
  if (!data && items[0]) data = await readDetails(items[0].key);
  const current = data?.definition;
  const keyChoices = current && !items.some(item => item.key === current.key) ? [current, ...items] : items;
  const queryFields = { scope: scope.id, at, scopeAfter, keyAfter };
  const message = formErrors[stringField(search.error)];
  const mayDraft = data && scope.write && (scope.root || data.definition.allow_override) &&
    data.definition.allowed_types.includes(scope.type_code);

  return (
    <main id="contenu" className="studio">
      <a href="/espace">Mon espace</a>
      <section className="studio-heading">
        <h1>Paramètres et versions</h1>
        <p>Consultez la valeur applicable et sa provenance par portée.</p>
      </section>

      {message && <p className="studio-notice" role="alert">{message}</p>}
      {!message && search.message === 'saved' && <p className="studio-notice" role="status">Modification enregistrée.</p>}

      <section className="studio-panel" aria-label="Filtres de consultation">
        <form method="get" className="studio-form studio-filters">
          <input type="hidden" name="scopeAfter" value={scopeAfter} />
          <input type="hidden" name="keyAfter" value={keyAfter} />
          <label>Portée<select name="scope" defaultValue={scope.id}>
            {scopeChoices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select></label>
          <label>Date et heure (UTC)<input name="at" type="datetime-local" defaultValue={at.slice(0, 16)} required /></label>
          <label>Paramètre<select name="key" defaultValue={current?.key ?? ''}>
            {!current && <option value="">Aucun paramètre</option>}
            {keyChoices.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select></label>
          <button type="submit" className="action">Consulter</button>
        </form>
        <div className="studio-links">
          {scopes.length > 50 && <a href={studioUrl({ at, scopeAfter: scopeOptions[49].id })}>Portées suivantes</a>}
          {scopeAfter && <a href={studioUrl({ at })}>Premières portées</a>}
          {definitions.length > 24 && <a href={studioUrl({ ...queryFields, keyAfter: items[23].key })}>Paramètres suivants</a>}
          {keyAfter && <a href={studioUrl({ ...queryFields, keyAfter: '' })}>Premiers paramètres</a>}
        </div>
      </section>

      {data ? (
        <>
          <section className="studio-panel" aria-labelledby="resolved-title">
            <h2 id="resolved-title">{data.definition.label}</h2>
            <p>{data.definition.description}</p>
            <dl className="studio-resolution">
              <div><dt>Valeur applicable</dt><dd>{formatValue(data.result.value)}</dd></div>
              <div><dt>Provenance</dt><dd>{data.result.source ? data.result.source.scope : data.result.value === null ? '—' : 'Valeur par défaut'}</dd></div>
              <div><dt>Version</dt><dd>{data.result.source?.version ?? '—'}</dd></div>
              <div><dt>Type</dt><dd>{kindLabels[data.definition.kind]}</dd></div>
            </dl>
            {data.result.source && <p>Depuis le {formatTime(data.result.source.effectiveFrom)} · {data.result.source.reason}</p>}
          </section>

          {data.preview && (() => {
            const { proposal, previous } = data.preview;
            const baseline = previous.source?.version ?? null;
            return (
              <section className="studio-panel" aria-labelledby="preview-title">
                <h2 id="preview-title">Prévisualiser la version {proposal.version}</h2>
                <p>{scope.label} · {formatTime(proposal.effective_from)}</p>
                <dl className="studio-resolution">
                  <div><dt>Valeur de référence</dt><dd>{formatValue(previous.value)}</dd></div>
                  <div><dt>Valeur proposée</dt><dd>{formatValue(proposal.value)}</dd></div>
                  <div><dt>État</dt><dd>{stateLabels[proposal.state]}</dd></div>
                </dl>
                <p>{proposal.reason}</p>
                <div className="studio-links">
                  {proposal.state === 'draft' && scope.write &&
                    <VersionAction version={proposal} action="submit" label="Soumettre à la revue" baseline={baseline} />}
                  {proposal.state === 'review' && scope.review && proposal.author_id !== actor &&
                    <VersionAction version={proposal} action="approve" label="Approuver la proposition" baseline={baseline} />}
                  {proposal.state === 'approved' && scope.publish &&
                    <VersionAction version={proposal} action="reopen" label="Renvoyer en revue" baseline={baseline} />}
                  {proposal.state === 'approved' && scope.publish && proposal.reviewed_against === baseline &&
                    <VersionAction version={proposal} action="publish" label="Confirmer la publication" baseline={baseline} />}
                </div>
              </section>
            );
          })()}

          {mayDraft && <DraftEditor def={data.definition} scopeId={scope.id} />}
          <section className="studio-panel" aria-labelledby="versions-title">
            <h2 id="versions-title">Versions de cette portée</h2>
            {data.versions.length === 0 ? <p>Aucune version locale.</p> : (
              <div className="studio-table" role="region" aria-label="Historique des versions" tabIndex={0}>
                <table>
                  <thead><tr><th>Version</th><th>Valeur</th><th>Date d’effet</th><th>État</th><th>Action</th></tr></thead>
                  <tbody>
                    {data.versions.map(version => (
                      <tr key={version.id}>
                        <td>{version.version}</td><td>{formatValue(version.value)}</td>
                        <td>{formatTime(version.effective_from)}</td>
                        <td>{version.state === 'published' && version.effective_from.getTime() > Date.now()
                          ? 'Programmée' : stateLabels[version.state]}</td>
                        <td>{version.state !== 'published'
                          ? <a href={studioUrl({ ...queryFields, key: current.key, preview: version.id, before: String(historyCursor ?? '') })}>Prévisualiser</a>
                          : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="studio-links">
              {data.next && <a href={studioUrl({ ...queryFields, key: current.key, before: String(data.next) })}>Versions précédentes</a>}
              {historyCursor && <a href={studioUrl({ ...queryFields, key: current.key })}>Versions récentes</a>}
            </div>
          </section>
        </>
      ) : (
        <section className="studio-panel"><h2>Catalogue</h2><p>Aucune définition disponible pour cette portée.</p></section>
      )}
      {scope.root && scope.define && <DefinitionEditor scopeId={scope.id} types={await scopeTypes(settings)} />}
    </main>
  );
}
