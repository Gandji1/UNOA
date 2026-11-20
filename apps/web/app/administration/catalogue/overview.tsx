import type { ReactNode } from 'react';
import type { catalogContexts, catalogOverview } from '@/lib/catalog/store';
import { ActionForm, Badge, Editor, Panel, Table } from '../forms';
import { regulatoryBadge, stateBadge } from './labels';

type Data = Awaited<ReturnType<typeof catalogOverview>>;
type Contexts = Awaited<ReturnType<typeof catalogContexts>>;
const path = '/administration/catalogue';
const api = '/api/v1/catalog/';

export function Overview({ data, contexts, notice }: { data: Data; contexts: Contexts; notice: ReactNode }) {
  const { scope, fieldTypes, kinds, fields, programs, courses, competencies } = data;
  const back = `${path}?scope=${scope.id}`;
  const activeFields = fields.filter(item => item.status === 'active');
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs">
        <a href="/espace">Mon espace</a> › <a href={path}>Catalogue</a> › <span aria-current="page">{scope.label}</span>
      </nav>
      <section className="studio-heading">
        <p className="eyebrow">Catalogue académique · {scope.type_label}</p>
        <h1>{scope.label}</h1>
        <p>Domaines, filières, spécialités, programmes, maquettes, UE et cours sont créés ici par l’administration habilitée.
          Aucune formation n’est fournie par le logiciel.</p>
      </section>
      {notice}

      <section className="studio-panel" aria-label="Choix de la structure">
        <form method="get" className="studio-form studio-filters">
          <label>Établissement ou composante<select name="scope" defaultValue={scope.id}>
            {contexts.map(item => <option key={item.id} value={item.id}>{item.nature === 'institution' ? '◆ ' : ''}{item.label}</option>)}
          </select></label>
          <button className="action" type="submit">Consulter</button>
        </form>
      </section>

      <Panel title="Programmes" id="programmes">
        {programs.length === 0 ? <p>Aucun programme dans cette structure.</p> : (
          <Table label="Programmes" head={['Code', 'Intitulé', 'Nature', 'Filière', 'Dernière version', 'Statut réglementaire']}>
            {programs.map(item => (
              <tr key={item.id}>
                <td>{item.code}</td>
                <td><a href={`${path}?program=${item.id}`}>{item.title}</a></td>
                <td>{item.kind_label}</td><td>{item.field_label ?? '—'}</td>
                <td>{item.current_number ? <>v{item.current_number} {stateBadge(item.current_state!)}</> : '—'}</td>
                <td>{regulatoryBadge(item.regulatory_status)}</td>
              </tr>
            ))}
          </Table>
        )}
        {scope.write && (kinds.length === 0 ? (
          <p className="studio-help">Déclarez d’abord une nature de programme (licence, master, formation courte…) à la racine.</p>
        ) : (
          <Editor summary="Créer un programme et sa première version">
            <ActionForm action={`${api}programs`} back={back} hidden={{ scopeId: scope.id }} submit="Créer le brouillon"
              confirm="La création ne vaut pas ouverture légale : la publication et l’ouverture des candidatures restent soumises à revue et à autorisation vérifiée.">
              <label>Nature<select name="kindCode" required>
                {kinds.map(kind => <option key={kind.code} value={kind.code}>{kind.label}{kind.degree_awarding ? ' · diplômant' : ''}</option>)}
              </select></label>
              <label>Domaine, filière ou spécialité<select name="fieldId" defaultValue="">
                <option value="">— aucun —</option>
                {activeFields.map(item => <option key={item.id} value={item.id}>{item.type_label} · {item.label}</option>)}
              </select></label>
              <label>Code<input name="code" required maxLength={32} /></label>
              <label>Intitulé<input name="title" required maxLength={200} /></label>
              <label>Organisation des périodes<input name="organisation" required maxLength={120} placeholder="semestrielle, trimestrielle, modulaire…" /></label>
              <label>Durée<input name="duration" required maxLength={120} /></label>
              <label>Modalité<input name="deliveryMode" required maxLength={120} placeholder="à distance, hybride…" /></label>
              <label>Unité de crédit<input name="creditUnit" required maxLength={60} /></label>
              <label>Total de crédits attendu<input type="number" name="expectedCredits" min={0} step="0.01" /></label>
              <label>Langues (codes séparés par des espaces)<input name="languages" maxLength={120} placeholder="fr en" /></label>
            </ActionForm>
          </Editor>
        ))}
      </Panel>

      <Panel title="Domaines, filières, mentions et spécialités" id="domaines">
        {fields.length === 0 ? <p>Aucune entrée de taxonomie.</p> : (
          <Table label="Taxonomie académique" head={['Code', 'Libellé', 'Type', 'Rattachement', 'Structure', 'État']}>
            {fields.map(item => (
              <tr key={item.id}>
                <td>{item.code}</td><td>{item.label}</td><td>{item.type_label}</td>
                <td>{fields.find(parent => parent.id === item.parent_id)?.label ?? '—'}</td>
                <td>{item.owner_label}</td>
                <td>{item.status === 'active' ? <Badge tone="ok">Actif</Badge> : <Badge tone="muted">Archivé</Badge>}
                  {item.status === 'active' && scope.write && (
                    <ActionForm inline action={`${api}fields/${item.id}/archive`} back={back} hidden={{ scopeId: scope.id }} submit="Archiver" />
                  )}</td>
              </tr>
            ))}
          </Table>
        )}
        {scope.write && fieldTypes.length > 0 && (
          <Editor summary="Ajouter un domaine, une filière, une mention, une spécialité ou un parcours">
            <ActionForm action={`${api}fields`} back={back} hidden={{ scopeId: scope.id }} submit="Ajouter">
              <label>Type<select name="typeCode" required>
                {fieldTypes.map(type => <option key={type.code} value={type.code}>{type.label}</option>)}
              </select></label>
              <label>Rattacher à<select name="parentId" defaultValue="">
                <option value="">— racine de la taxonomie —</option>
                {activeFields.map(item => <option key={item.id} value={item.id}>{item.type_label} · {item.label}</option>)}
              </select></label>
              <label>Code<input name="code" required maxLength={32} /></label>
              <label>Libellé<input name="label" required maxLength={200} /></label>
              <label className="studio-wide">Description<textarea name="description" maxLength={2000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Cours du catalogue" id="cours">
        <p className="studio-help">Un cours peut être mutualisé entre plusieurs programmes de l’établissement.</p>
        {courses.length === 0 ? <p>Aucun cours.</p> : (
          <Table label="Cours" head={['Code', 'Intitulé', 'Programmes utilisateurs']}>
            {courses.map(item => <tr key={item.id}><td>{item.code}</td><td>{item.title}</td><td>{item.programs}</td></tr>)}
          </Table>
        )}
        {scope.write && (
          <Editor summary="Créer un cours">
            <ActionForm action={`${api}courses`} back={back} hidden={{ scopeId: scope.id }} submit="Créer">
              <label>Code<input name="code" required maxLength={32} /></label>
              <label>Intitulé<input name="title" required maxLength={200} /></label>
              <label className="studio-wide">Description<textarea name="description" maxLength={2000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Compétences et résultats d’apprentissage" id="competences">
        {competencies.length === 0 ? <p>Aucune compétence.</p> : (
          <Table label="Compétences" head={['Code', 'Libellé', 'Description']}>
            {competencies.map(item => <tr key={item.id}><td>{item.code}</td><td>{item.label}</td><td>{item.description ?? '—'}</td></tr>)}
          </Table>
        )}
        {scope.write && (
          <Editor summary="Définir une compétence">
            <ActionForm action={`${api}competencies`} back={back} hidden={{ scopeId: scope.id }} submit="Définir">
              <label>Code<input name="code" required maxLength={32} /></label>
              <label>Libellé<input name="label" required maxLength={200} /></label>
              <label className="studio-wide">Description<textarea name="description" maxLength={2000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Référentiels de la plateforme" id="referentiels">
        <div className="two-columns">
          <div><h3>Natures de programme</h3>
            {kinds.length === 0 ? <p>Aucune nature déclarée.</p> : <ul>{kinds.map(kind => (
              <li key={kind.code}>{kind.label} {kind.degree_awarding ? <Badge tone="info">diplômant</Badge> : <Badge tone="muted">non diplômant</Badge>}</li>
            ))}</ul>}</div>
          <div><h3>Types de taxonomie</h3>
            {fieldTypes.length === 0 ? <p>Aucun type déclaré.</p> : <ul>{fieldTypes.map(type => (
              <li key={type.code}>{type.label}<span className="muted"> · {type.root_allowed ? 'racine' : ''}{type.parents.length ? ' sous ' + type.parents.join(', ') : ''}</span></li>
            ))}</ul>}</div>
        </div>
        {scope.define && (
          <>
            <Editor summary="Déclarer une nature de programme">
              <ActionForm action={`${api}program-kinds`} back={back} submit="Déclarer">
                <label>Code technique<input name="code" required maxLength={63} pattern="[a-z][a-z0-9_]*" /></label>
                <label>Libellé<input name="label" required maxLength={120} /></label>
                <label className="studio-checkbox"><input type="checkbox" name="degreeAwarding" /> Conduit à un diplôme</label>
                <label className="studio-wide">Description<textarea name="description" maxLength={1000} /></label>
              </ActionForm>
            </Editor>
            <Editor summary="Déclarer un type de taxonomie (domaine, filière, spécialité…)">
              <ActionForm action={`${api}field-types`} back={back} submit="Déclarer">
                <label>Code technique<input name="code" required maxLength={63} pattern="[a-z][a-z0-9_]*" /></label>
                <label>Libellé<input name="label" required maxLength={120} /></label>
                <label className="studio-checkbox"><input type="checkbox" name="rootAllowed" /> Peut être à la racine</label>
                <fieldset className="studio-wide"><legend>Peut se placer sous</legend>
                  {fieldTypes.length === 0 ? <p>Aucun type existant.</p> : fieldTypes.map(type => (
                    <label key={type.code} className="studio-checkbox"><input type="checkbox" name="parentTypes" value={type.code} /> {type.label}</label>
                  ))}
                </fieldset>
              </ActionForm>
            </Editor>
          </>
        )}
      </Panel>
    </main>
  );
}
