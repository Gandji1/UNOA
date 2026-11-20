import type { PublicProgram } from '@/lib/catalog/public';
import { regulatoryLabels } from '@/lib/catalog/public';

const tone = (status: string) => status === 'authorized' ? 'ok' : status === 'conditional' || status === 'non_degree' ? 'info'
  : status === 'suspended' || status === 'expired' ? 'danger' : 'muted';

// Card of a published programme, as in the reference catalogue.
export function ProgramCard({ item, compare }: { item: PublicProgram; compare?: boolean }) {
  return (
    <li className="program-card">
      <div className="card-top"><span className="code">{item.code}</span><span className="cycle">{item.kind_label}</span></div>
      <span className={'status badge-' + tone(item.regulatory_status)}>{regulatoryLabels[item.regulatory_status]}</span>
      <h3><a href={`/formations/${item.program_id}`}>{item.title}</a></h3>
      <p className="muted">{item.owner_label}{item.field_label ? ' · ' + item.field_label : ''}</p>
      <div className="card-facts"><span>{item.duration} · {item.delivery_mode}</span><span>{item.languages.join(', ')}</span></div>
      <div className="card-actions">
        <a className="action small" href={`/formations/${item.program_id}`}>Voir la fiche</a>
        <span className={'badge badge-' + (item.admission_open ? 'ok' : 'muted')}>{item.admission_open ? 'Candidatures ouvertes' : 'Candidatures fermées'}</span>
        {compare && <label className="compare"><input type="checkbox" name="id" value={item.program_id} /> Comparer</label>}
      </div>
    </li>
  );
}
