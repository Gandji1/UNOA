import type { AttachmentRow, ScopeTypeRow, TerritoryScope } from '@/lib/territory/store';
import { natures } from '@/lib/territory/validation';

export const natureLabels: Record<string, string> = {
  platform: 'Plateforme', territory: 'Territoire', jurisdiction: 'Juridiction',
  institution: 'Établissement', centre: 'Centre',
};
export const kindLabels: Record<string, string> = {
  implantation: 'Implantation territoriale', regulatory: 'Cadre réglementaire',
};

export function formatTime(date: Date | null) {
  if (!date) return 'Sans terme';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
    .format(date) + ' UTC';
}

export const isEstablishment = (scope: TerritoryScope) => scope.nature === 'institution' || scope.nature === 'centre';

function AttributeFields({ scope, defaults }: { scope: TerritoryScope; defaults?: TerritoryScope }) {
  return (
    <>
      <label>Libellé<input name="label" required maxLength={160} defaultValue={defaults?.label} /></label>
      <label>Fuseau IANA<input name="timeZone" maxLength={64} placeholder="Africa/Porto-Novo"
        defaultValue={defaults?.time_zone ?? ''} /></label>
      <label>Monnaie ISO 4217<input name="currency" maxLength={3} placeholder="XOF"
        defaultValue={defaults?.currency ?? ''} /></label>
      <label>Format régional<input name="locale" maxLength={35} placeholder="fr-BJ"
        defaultValue={defaults?.locale ?? ''} /></label>
      <label>Fin de présence (UTC)<input type="datetime-local" name="presentUntil"
        defaultValue={defaults?.present_until ? defaults.present_until.toISOString().slice(0, 16) : ''} /></label>
      {(defaults ? isEstablishment(defaults) : true) ? (
        <>
          <label>Identité légale<input name="legalName" maxLength={200} defaultValue={defaults?.legal_name ?? ''} /></label>
          <label className="studio-wide">Contacts publiés<textarea name="contact" maxLength={500}
            defaultValue={defaults?.contact ?? ''} /></label>
        </>
      ) : null}
    </>
  );
}

export function TerritoryEditor({ scope }: { scope: TerritoryScope }) {
  return (
    <details className="studio-panel">
      <summary>Modifier cette portée</summary>
      <form method="post" action={`/api/v1/territories/scopes/${scope.id}/update`} className="studio-form">
        <input type="hidden" name="scopeId" value={scope.id} />
        <AttributeFields scope={scope} defaults={scope} />
        <p className="studio-wide">L’identité légale n’est acceptée que pour un établissement ou un centre.</p>
        <div className="studio-wide"><button className="action" type="submit">Enregistrer</button></div>
      </form>
    </details>
  );
}

export function ChildEditor({ scope, types }: { scope: TerritoryScope; types: ScopeTypeRow[] }) {
  const allowed = types.filter(type => type.parents.includes(scope.type_code));
  if (allowed.length === 0) {
    return (
      <section className="studio-panel">
        <h2>Créer une portée fille</h2>
        <p>Aucun type n’est déclaré sous « {scope.type_label} ». Déclarez d’abord la hiérarchie à la racine.</p>
      </section>
    );
  }
  return (
    <details className="studio-panel">
      <summary>Créer une portée fille</summary>
      <form method="post" action="/api/v1/territories/scopes" className="studio-form">
        <input type="hidden" name="scopeId" value={scope.id} />
        <input type="hidden" name="parentId" value={scope.id} />
        <label>Type<select name="typeCode" required>
          {allowed.map(type => (
            <option key={type.code} value={type.code}>{type.label} · {natureLabels[type.nature]}</option>
          ))}
        </select></label>
        <label>Début de présence (UTC)<input type="datetime-local" name="presentFrom" required /></label>
        <AttributeFields scope={scope} />
        <p className="studio-wide">La présence doit rester comprise dans celle de la portée mère.</p>
        <div className="studio-wide"><button className="action" type="submit">Créer la portée</button></div>
      </form>
    </details>
  );
}

export function LabelEditor({ scope }: { scope: TerritoryScope }) {
  return (
    <details className="studio-panel">
      <summary>Ajouter ou remplacer une désignation</summary>
      <form method="post" action={`/api/v1/territories/scopes/${scope.id}/labels`} className="studio-form">
        <input type="hidden" name="scopeId" value={scope.id} />
        <label>Langue<input name="language" required maxLength={6} placeholder="fr" pattern="[a-z]{2,3}(-[A-Z]{2})?" /></label>
        <label>Désignation<input name="label" required maxLength={160} /></label>
        <div className="studio-wide"><button className="action" type="submit">Enregistrer la désignation</button></div>
      </form>
    </details>
  );
}

export function AttachmentEditor({ scope, targets }: { scope: TerritoryScope; targets: TerritoryScope[] }) {
  return (
    <details className="studio-panel">
      <summary>Rattacher à un territoire ou à une juridiction</summary>
      <form method="post" action={`/api/v1/territories/scopes/${scope.id}/attachments`} className="studio-form">
        <input type="hidden" name="scopeId" value={scope.id} />
        <label>Nature du rattachement<select name="kind" required>
          {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Portée visée<select name="territoryId" required>
          {targets.map(target => (
            <option key={target.id} value={target.id}>{target.label} · {natureLabels[target.nature]}</option>
          ))}
        </select></label>
        <label>Début (UTC)<input type="datetime-local" name="effectiveFrom" required /></label>
        <label>Fin facultative (UTC)<input type="datetime-local" name="effectiveUntil" /></label>
        <label className="studio-wide">Justification<textarea name="reason" maxLength={500} required /></label>
        <div className="studio-wide"><button className="action" type="submit">Enregistrer le rattachement</button></div>
      </form>
    </details>
  );
}

export function AttachmentClosure({ scope, attachment }: { scope: TerritoryScope; attachment: AttachmentRow }) {
  return (
    <form method="post" action={`/api/v1/territories/attachments/${attachment.id}/close`} className="studio-form">
      <input type="hidden" name="scopeId" value={scope.id} />
      <label>Fin (UTC)<input type="datetime-local" name="effectiveUntil" required /></label>
      <button className="action" type="submit">Clore</button>
    </form>
  );
}

export function TypeEditor({ scope, types }: { scope: TerritoryScope; types: ScopeTypeRow[] }) {
  return (
    <details className="studio-panel">
      <summary>Déclarer un type de portée et sa hiérarchie</summary>
      <form method="post" action="/api/v1/territories/types" className="studio-form">
        <input type="hidden" name="scopeId" value={scope.id} />
        <label>Code<input name="code" required maxLength={63} pattern="[a-z][a-z0-9_]*" placeholder="region" /></label>
        <label>Libellé<input name="label" required maxLength={120} /></label>
        <label>Nature<select name="nature" required defaultValue="territory">
          {natures.map(value => <option key={value} value={value}>{natureLabels[value]}</option>)}
        </select></label>
        <fieldset className="studio-wide">
          <legend>Types parents autorisés</legend>
          {types.length === 0 ? <p>Aucun type existant : seule une nature plateforme peut être déclarée.</p> : types.map(type => (
            <label className="studio-checkbox" key={type.code}>
              <input type="checkbox" name="parentTypes" value={type.code} />{type.label}
            </label>
          ))}
        </fieldset>
        <p className="studio-wide">La nature plateforme ne prend aucun parent ; toute autre nature en exige au moins un.</p>
        <div className="studio-wide"><button className="action" type="submit">Déclarer le type</button></div>
      </form>
    </details>
  );
}
