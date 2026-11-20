import type { Metadata } from 'next';
import { iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { publicSheet, type PublicSheet } from '@/lib/catalog/public';
import { currentSite } from '@/lib/site/store';
import { regulatoryLabels } from '@/lib/catalog/public';

export const metadata: Metadata = { title: 'Comparer des formations' };
export const dynamic = 'force-dynamic';

export default async function Comparer({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const { id } = await searchParams;
  const ids = (Array.isArray(id) ? id : id ? [id] : []).filter(value => scopeIdFormat.test(value)).slice(0, 4);
  const settings = iamSettings();
  const site = await currentSite();
  const sheets = settings && site
    ? (await Promise.all(ids.map(value => publicSheet(settings, site.site_id, value).catch(() => null)))).filter((item): item is PublicSheet => !!item)
    : [];
  const rows: [string, (sheet: PublicSheet) => string][] = [
    ['Nature', sheet => sheet.program.kind],
    ['Structure', sheet => sheet.program.owner + ' · ' + sheet.program.institution],
    ['Statut réglementaire', sheet => regulatoryLabels[sheet.program.regulatoryStatus]],
    ['Candidatures', sheet => sheet.program.admissionOpen ? 'Ouvertes' : 'Fermées'],
    ['Durée', sheet => sheet.version.duration],
    ['Organisation', sheet => sheet.version.organisation],
    ['Modalité', sheet => sheet.version.deliveryMode],
    ['Crédits', sheet => sheet.version.expectedCredits ? `${Number(sheet.version.expectedCredits)} ${sheet.version.creditUnit}` : '—'],
    ['Langues', sheet => sheet.version.languages.join(', ') || '—'],
    ['Zones', sheet => sheet.territories.join(', ') || '—'],
    ['Périodes', sheet => String(sheet.periods.length)],
    ['Stages et mémoires', sheet => sheet.requirements.map(item => item.label).join(', ') || '—'],
  ];
  return (
    <main id="contenu" className="page">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/formations">Formations</a> › Comparer</nav>
      <section className="page-heading"><h1>Comparer des formations</h1></section>
      {sheets.length < 2 ? <p className="card-note">Sélectionnez au moins deux formations publiées dans le catalogue.</p> : (
        <div className="studio-table" role="region" aria-label="Comparaison" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Critère</th>{sheets.map(sheet => <th key={sheet.program.id} scope="col">
              <a href={`/formations/${sheet.program.id}`}>{sheet.version.title}</a></th>)}</tr></thead>
            <tbody>{rows.map(([label, read]) => (
              <tr key={label}><th scope="row">{label}</th>{sheets.map(sheet => <td key={sheet.program.id}>{read(sheet)}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
