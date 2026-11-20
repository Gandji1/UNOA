import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { publicOrganisation } from '@/lib/org/store';

export const metadata: Metadata = { title: 'Structures · UNOA', description: 'Organigramme public de l’université' };
export const dynamic = 'force-dynamic';

const capacityLabels: Record<string, string> = { titular: '', deputy: 'suppléance', interim: 'intérim' };
type Organisation = Awaited<ReturnType<typeof publicOrganisation>>;

function Branch({ parent, data }: { parent: string; data: Organisation }) {
  const units = data.units.filter(unit => unit.parent_id === parent);
  if (units.length === 0) return null;
  return (
    <ul className="org-tree">
      {units.map(unit => (
        <li key={unit.id}>
          <strong>{unit.label}</strong> <span className="muted">· {unit.type_label}</span>
          {unit.mission && <p>{unit.mission}</p>}
          {data.positions.filter(position => position.unit_id === unit.id).map((position, index) => (
            <p key={index} className="muted">{position.title} : {position.holder}{capacityLabels[position.capacity] ? ` (${capacityLabels[position.capacity]})` : ''}</p>
          ))}
          <Branch parent={unit.id} data={data} />
        </li>
      ))}
    </ul>
  );
}

export default async function Structures() {
  const settings = iamSettings();
  const data = settings ? await publicOrganisation(settings).catch(() => null) : null;
  const institutions: [string, string][] = data ? [...new Map<string, string>(data.units.map(unit => [unit.institution_id, unit.institution_label] as [string, string])).entries()] : [];
  return (
    <main id="contenu">
      <section className="page-heading"><p className="eyebrow">Université</p><h1>Structures</h1>
        <p>Facultés, écoles, instituts, départements et laboratoires publiés par l’université.</p></section>
      {!data ? <p className="card-note" role="status">L’organigramme est momentanément indisponible.</p>
        : institutions.length === 0 ? <p className="card-note">Aucune composante n’est encore publiée.</p>
        : institutions.map(([id, label]) => (
          <section key={id} className="studio-panel"><h2>{label}</h2><Branch parent={id} data={data} /></section>
        ))}
    </main>
  );
}
