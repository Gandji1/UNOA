import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { publicPrograms, type PublicProgram } from '@/lib/catalog/public';
import { regulatoryLabels } from '@/lib/catalog/public';

export const metadata: Metadata = { title: 'Formations · UNOA', description: 'Catalogue des formations publiées' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value.slice(0, 120) : '';
const distinct = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'fr'));

export default async function Formations({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  const search = await searchParams;
  let programs: PublicProgram[] | null = null;
  if (settings) programs = await publicPrograms(settings).catch(() => null);
  const filters = { q: field(search.q), nature: field(search.nature), langue: field(search.langue), zone: field(search.zone), modalite: field(search.modalite) };
  const needle = filters.q.toLocaleLowerCase('fr');
  const shown = (programs ?? []).filter(item =>
    (!needle || [item.title, item.code, item.field_label ?? '', item.owner_label].some(value => value.toLocaleLowerCase('fr').includes(needle))) &&
    (!filters.nature || item.kind_label === filters.nature) &&
    (!filters.langue || item.languages.includes(filters.langue)) &&
    (!filters.zone || item.territories.includes(filters.zone)) &&
    (!filters.modalite || item.delivery_mode === filters.modalite));
  const all = programs ?? [];
  return (
    <main id="contenu">
      <section className="page-heading">
        <p className="eyebrow">Catalogue</p>
        <h1>Formations</h1>
        <p>Seules les versions publiées par l’université apparaissent, avec leur statut réglementaire vérifié.</p>
      </section>
      {programs === null ? (
        <p className="card-note" role="status">Le catalogue est momentanément indisponible. Réessayez dans quelques instants.</p>
      ) : all.length === 0 ? (
        <p className="card-note">Aucune formation n’est encore publiée. Le catalogue s’ouvrira dès la publication des premières formations par l’université.</p>
      ) : (
        <>
          <form method="get" className="filters" role="search" aria-label="Filtrer les formations">
            <label>Recherche<input type="search" name="q" defaultValue={filters.q} maxLength={120} /></label>
            <label>Niveau ou nature<select name="nature" defaultValue={filters.nature}><option value="">Tous</option>
              {distinct(all.map(item => item.kind_label)).map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Langue<select name="langue" defaultValue={filters.langue}><option value="">Toutes</option>
              {distinct(all.flatMap(item => item.languages)).map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Zone<select name="zone" defaultValue={filters.zone}><option value="">Toutes</option>
              {distinct(all.flatMap(item => item.territories)).map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Modalité<select name="modalite" defaultValue={filters.modalite}><option value="">Toutes</option>
              {distinct(all.map(item => item.delivery_mode)).map(value => <option key={value}>{value}</option>)}</select></label>
            <button className="action" type="submit">Filtrer</button>
          </form>
          <p role="status" className="muted">{shown.length} formation(s)</p>
          <form method="get" action="/formations/comparer">
            <ul className="program-grid">
              {shown.map(item => (
                <li key={item.program_id} className="program-card">
                  <p className="eyebrow">{item.kind_label}{item.field_label ? ' · ' + item.field_label : ''}</p>
                  <h2><a href={`/formations/${item.program_id}`}>{item.title}</a></h2>
                  <p className="muted">{item.owner_label} · {item.institution_label}</p>
                  <p>{item.duration} · {item.delivery_mode}{item.languages.length ? ' · ' + item.languages.join(', ') : ''}</p>
                  <p><span className={'badge badge-' + (item.regulatory_status === 'authorized' ? 'ok' : 'muted')}>{regulatoryLabels[item.regulatory_status]}</span>
                    {' '}<span className={'badge badge-' + (item.admission_open ? 'ok' : 'muted')}>{item.admission_open ? 'Candidatures ouvertes' : 'Candidatures fermées'}</span></p>
                  <label className="compare"><input type="checkbox" name="id" value={item.program_id} /> Comparer</label>
                </li>
              ))}
            </ul>
            {shown.length > 1 && <button className="secondary" type="submit">Comparer la sélection</button>}
          </form>
        </>
      )}
    </main>
  );
}
