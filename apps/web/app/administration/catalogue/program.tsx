import type { ReactNode } from 'react';
import type { programDetails } from '@/lib/catalog/programs';
import { regulatoryLabels } from '@/lib/catalog/public';
import { ActionForm, Badge, Editor, formatTime, Panel, Table } from '../forms';
import { regulatoryBadge, stateBadge } from './labels';

type Data = Awaited<ReturnType<typeof programDetails>>;
const path = '/administration/catalogue';
const api = '/api/v1/catalog/';

export function ProgramView({ data, actor, notice }: { data: Data; actor: string; notice: ReactNode }) {
  const { program, scope, labels, versions, authorizations, territories } = data;
  const back = `${path}?program=${program.id}`;
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs">
        <a href="/espace">Mon espace</a> › <a href={path}>Catalogue</a> ›{' '}
        <a href={`${path}?scope=${program.owner_scope_id}`}>{program.owner_label}</a> › <span aria-current="page">{program.code}</span>
      </nav>
      <section className="studio-heading">
        <p className="eyebrow">{program.kind_label}{program.field_label ? ' · ' + program.field_label : ''}</p>
        <h1>{program.title}</h1>
        <p>Code {program.code} · {regulatoryLabels[program.regulatory_status]}
          {program.admission_allowed ? ' · candidatures autorisables' : ' · candidatures non autorisables'}</p>
      </section>
      {notice}

      <Panel title="Versions de la maquette" id="versions">
        <Table label="Versions" head={['Version', 'Intitulé', 'État', 'Publication', 'Candidatures']}>
          {versions.map(version => (
            <tr key={version.id}>
              <td><a href={`${path}?version=${version.id}`}>v{version.number}</a></td>
              <td>{version.title}</td><td>{stateBadge(version.state)}</td>
              <td>{version.published_at ? formatTime(version.published_at) : '—'}</td>
              <td>{version.admission_open ? <Badge tone="ok">ouvertes</Badge> : <Badge tone="muted">fermées</Badge>}</td>
            </tr>
          ))}
        </Table>
        <p className="studio-help">Une version publiée est immuable. Les étudiants inscrits restent liés à leur version.</p>
      </Panel>

      <Panel title="Statut réglementaire et autorisations" id="autorisations">
        <p>Statut en vigueur : {regulatoryBadge(program.regulatory_status)}. Seule une pièce enregistrée puis vérifiée par une
          seconde personne produit un statut. Aucune autorisation n’est présumée.</p>
        {authorizations.length === 0 ? <p>Aucune pièce enregistrée.</p> : (
          <Table label="Autorisations" head={['Statut', 'Autorité', 'Pièce', 'Zone', 'Validité', 'Vérification']}>
            {authorizations.map(item => (
              <tr key={item.id}>
                <td>{regulatoryBadge(item.status)}</td><td>{item.authority}</td><td>{item.evidence}</td>
                <td>{item.territory_label ?? 'Toutes zones'}</td>
                <td>{formatTime(item.valid_from)} → {formatTime(item.valid_until)}</td>
                <td>{item.verified_at ? 'Vérifiée le ' + formatTime(item.verified_at)
                  : scope?.authorize && item.recorded_by !== actor ? (
                    <ActionForm inline action={`${api}authorizations/${item.id}/verify`} back={back}
                      hidden={{ programId: program.id }} submit="Confirmer après contrôle de la pièce" />
                  ) : <Badge tone="warn">À vérifier par une autre personne</Badge>}</td>
              </tr>
            ))}
          </Table>
        )}
        {scope?.authorize && (
          <Editor summary="Enregistrer une pièce réglementaire">
            <ActionForm action={`${api}programs/${program.id}/authorizations`} back={back} submit="Enregistrer"
              confirm="Renseignez la référence exacte de l’acte officiel. Une donnée fictive ne doit jamais remplacer une donnée officielle.">
              <label>Statut<select name="status">
                {Object.entries(regulatoryLabels).filter(([key]) => key !== 'unverified').map(([value, label]) =>
                  <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>Autorité<input name="authority" required maxLength={200} /></label>
              <label className="studio-wide">Référence de la pièce<input name="evidence" required maxLength={1000} /></label>
              <label>Zone<select name="territoryId" defaultValue="">
                <option value="">Toutes zones</option>
                {territories.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}
              </select></label>
              <label>Début de validité (UTC)<input type="datetime-local" name="validFrom" required /></label>
              <label>Fin de validité (UTC)<input type="datetime-local" name="validUntil" /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Intitulés traduits" id="traductions">
        {labels.length === 0 ? <p>Aucune traduction.</p> : (
          <Table label="Traductions" head={['Langue', 'Intitulé', 'Résumé']}>
            {labels.map(item => <tr key={item.language}><td>{item.language}</td><td>{item.title}</td><td>{item.summary ?? '—'}</td></tr>)}
          </Table>
        )}
        {scope?.write && (
          <Editor summary="Ajouter ou remplacer une traduction">
            <ActionForm action={`${api}programs/${program.id}/labels`} back={back} submit="Enregistrer">
              <label>Langue<input name="language" required maxLength={6} placeholder="en" /></label>
              <label>Intitulé<input name="title" required maxLength={200} /></label>
              <label className="studio-wide">Résumé<textarea name="summary" maxLength={2000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>
    </main>
  );
}
