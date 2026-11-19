import { randomUUID } from 'node:crypto';
import type { Definition, Version } from '@/lib/config/store';

export const kindLabels = { text: 'Texte', boolean: 'Oui / Non', number: 'Nombre', choice: 'Liste' };
export const stateLabels = { draft: 'Brouillon', review: 'En revue', approved: 'Approuvé', published: 'Publié' };

export function formatValue(value: string | boolean | number | null) {
  if (value === null) return 'Aucune valeur';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  return String(value);
}

export function formatTime(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC';
}

export function DefinitionEditor({ scopeId, types }: { scopeId: string; types: { code: string; label: string }[] }) {
  return (
    <details className="studio-panel">
      <summary>Créer une définition</summary>
      <form method="post" action="/api/v1/config/definitions" className="studio-form">
        <input type="hidden" name="scopeId" value={scopeId} />
        <label>Clé<input name="key" required maxLength={96} placeholder="exemple.parametre" /></label>
        <label>Libellé<input name="label" required maxLength={120} /></label>
        <label className="studio-wide">Description<textarea name="description" maxLength={500} required /></label>
        <label>Type<select name="kind">{Object.entries(kindLabels).map(([key, label]) =>
          <option key={key} value={key}>{label}</option>
        )}</select></label>
        <label>Défaut facultatif<input name="defaultValue" maxLength={1000} aria-describedby="default-format" /></label>
        <p id="default-format" className="studio-wide">Pour Oui / Non, saisir true ou false.</p>
        <fieldset className="studio-wide">
          <legend>Types de portées autorisés</legend>
          {types.map(type => (
            <label className="studio-checkbox" key={type.code}>
              <input type="checkbox" name="allowedTypes" value={type.code} />{type.label}
            </label>
          ))}
        </fieldset>
        <label className="studio-checkbox"><input type="checkbox" name="inherits" defaultChecked />Autoriser l’héritage</label>
        <label className="studio-checkbox"><input type="checkbox" name="allowOverride" />Autoriser les surcharges locales</label>
        <details className="studio-wide">
          <summary>Bornes ou options</summary>
          <div className="studio-form">
            <label>Minimum numérique<input name="minimum" type="number" step="any" /></label>
            <label>Maximum numérique<input name="maximum" type="number" step="any" /></label>
            <label className="studio-wide">Choix de liste, un par ligne<textarea name="choices" maxLength={3900} /></label>
          </div>
        </details>
        <div className="studio-wide"><button className="action" type="submit">Créer la définition</button></div>
      </form>
    </details>
  );
}

export function DraftEditor({ def, scopeId }: { def: Definition; scopeId: string }) {
  return (
    <details className="studio-panel">
      <summary>Proposer une valeur</summary>
      <form method="post" action="/api/v1/config/values" className="studio-form">
        <input type="hidden" name="scopeId" value={scopeId} />
        <input type="hidden" name="key" value={def.key} />
        <input type="hidden" name="requestId" value={randomUUID()} />
        <label>Valeur
          {def.kind === 'boolean' ? <select name="value" required><option value="true">Oui</option><option value="false">Non</option></select>
            : def.kind === 'choice' ? <select name="value" required>{def.choices.map(option =>
              <option key={option} value={option}>{option}</option>
            )}</select>
              : def.kind === 'number' ? <input name="value" type="number" step="any" min={def.minimum ?? undefined} max={def.maximum ?? undefined} required />
                : <input name="value" maxLength={1000} required />}
        </label>
        <label>Date et heure d’effet (UTC)<input type="datetime-local" name="effectiveFrom" required /></label>
        <label className="studio-wide">Justification<textarea name="reason" maxLength={500} required /></label>
        <div className="studio-wide"><button className="action" type="submit">Créer le brouillon</button></div>
      </form>
    </details>
  );
}

export function VersionAction({ version, action, label, baseline }: {
  version: Version; action: string; label: string; baseline: number | null;
}) {
  return (
    <form method="post" action={`/api/v1/config/versions/${version.id}/${action}`}>
      <input type="hidden" name="scopeId" value={version.scope_id} />
      <input type="hidden" name="key" value={version.definition_key} />
      <input type="hidden" name="previewVersion" value={baseline ?? ''} />
      <button className="action" type="submit">{label}</button>
    </form>
  );
}
