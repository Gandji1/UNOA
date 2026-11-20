import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { issueMessages, simulatePlan } from '@unoa/domain/curriculum';
import { iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { publicSheet, sheetModel } from '@/lib/catalog/public';
import { currentSite } from '@/lib/site/store';
import { regulatoryLabels } from '@/lib/catalog/public';

export const dynamic = 'force-dynamic';
type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ choice?: string | string[]; simuler?: string }> };

async function load(id: string) {
  const settings = iamSettings();
  if (!settings || !scopeIdFormat.test(id)) return null;
  const site = await currentSite();
  if (!site) return null;
  return publicSheet(settings, site.site_id, id).catch(() => null);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const sheet = await load((await params).id);
  return { title: sheet ? `${sheet.version.title}` : 'Formation' };
}

const kindLabels: Record<string, string> = { internship: 'Stage', thesis: 'Mémoire', defense: 'Soutenance', project: 'Projet', other: 'Autre' };

export default async function Formation({ params, searchParams }: Params) {
  const sheet = await load((await params).id);
  if (!sheet) notFound();
  const { program, version } = sheet;
  const search = await searchParams;
  const choices = (Array.isArray(search.choice) ? search.choice : search.choice ? [search.choice] : []).filter(value => scopeIdFormat.test(value));
  const plan = search.simuler === '1' ? simulatePlan(sheetModel(sheet), choices) : null;
  const electives = sheet.periods.flatMap(period => period.units.filter(unit => unit.groupId));
  const codes = new Map(sheet.periods.flatMap(period => period.units.map(unit => [unit.id, unit.code] as const)));
  return (
    <main id="contenu" className="page sheet">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/formations">Formations</a> › <span aria-current="page">{program.code}</span></nav>
      <section className="welcome compact">
        <div>
          <p className="eyebrow">{program.kind}{program.field ? ' · ' + program.field : ''}</p>
          <h1>{version.title}</h1>
          <p>{program.owner} · {program.institution}</p>
          <p className="badges">
            <span className={'badge badge-' + (program.regulatoryStatus === 'authorized' ? 'ok' : 'muted')}>{regulatoryLabels[program.regulatoryStatus]}</span>
            <span className={'badge badge-' + (program.admissionOpen ? 'ok' : 'muted')}>{program.admissionOpen ? 'Candidatures ouvertes' : 'Candidatures fermées'}</span>
            <span className="badge badge-muted">Version {version.number}</span>
          </p>
        </div>
      </section>
      {!program.degreeAwarding && <p className="card-note">Formation non diplômante : elle ne conduit pas à un diplôme national.</p>}
      {program.degreeAwarding && program.regulatoryStatus !== 'authorized' && program.regulatoryStatus !== 'conditional' &&
        <p className="card-note">Aucune habilitation à délivrer le diplôme n’est vérifiée pour cette formation à ce jour.</p>}

      <section className="facts" aria-label="Caractéristiques">
        <div><span>Durée</span><strong>{version.duration}</strong></div>
        <div><span>Organisation</span><strong>{version.organisation}</strong></div>
        <div><span>Modalité</span><strong>{version.deliveryMode}</strong></div>
        <div><span>Crédits</span><strong>{version.expectedCredits ? `${Number(version.expectedCredits)} ${version.creditUnit}` : '—'}</strong></div>
        <div><span>Langues</span><strong>{version.languages.join(', ') || '—'}</strong></div>
        <div><span>Zones</span><strong>{sheet.territories.join(', ') || 'Non restreintes'}</strong></div>
      </section>

      {version.objectives && <section><h2>Objectifs</h2><p>{version.objectives}</p></section>}
      {version.admission && <section><h2>Admission</h2><p>{version.admission}</p></section>}
      {sheet.competencies.length > 0 && <section><h2>Compétences visées</h2>
        <ul>{sheet.competencies.map(item => <li key={item.code}>{item.label}</li>)}</ul></section>}

      <section aria-labelledby="maquette"><h2 id="maquette">Maquette</h2>
        {sheet.periods.map(period => (
          <article key={period.ordinal} className="period">
            <h3>{period.label}</h3>
            {period.groups.map(group => <p key={group.id} className="muted">Options « {group.label} » : {group.min} à {group.max} au choix</p>)}
            <div className="studio-table" role="region" aria-label={'UE ' + period.label} tabIndex={0}>
              <table>
                <thead><tr><th scope="col">Code</th><th scope="col">UE</th><th scope="col">Crédits</th><th scope="col">Volumes</th><th scope="col">Cours</th><th scope="col">Prérequis</th></tr></thead>
                <tbody>{period.units.map(unit => (
                  <tr key={unit.id}>
                    <td>{unit.code}</td><td>{unit.title}{unit.groupId && <span className="badge badge-info">option</span>}</td>
                    <td>{Number(unit.credits)}</td>
                    <td>{unit.volumes.map(volume => `${volume.activity} ${Number(volume.hours)} h`).join(', ') || '—'}</td>
                    <td>{unit.courses.map(course => course.title).join(', ') || '—'}</td>
                    <td>{unit.requires.map(required => codes.get(required)).join(', ') || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </article>
        ))}
      </section>

      {sheet.requirements.length > 0 && <section><h2>Stages, mémoires et soutenances</h2>
        <ul>{sheet.requirements.map(item => <li key={item.label}>{kindLabels[item.kind]} : {item.label}{item.credits ? ` (${Number(item.credits)} ${version.creditUnit})` : ''}{item.mandatory ? '' : ' — facultatif'}</li>)}</ul></section>}

      <section aria-labelledby="simulation"><h2 id="simulation">Simuler mon plan d’études</h2>
        <form method="get" className="filters">
          <input type="hidden" name="simuler" value="1" />
          {electives.length === 0 ? <p>Toutes les UE sont obligatoires.</p> : electives.map(unit => (
            <label key={unit.id} className="compare"><input type="checkbox" name="choice" value={unit.id} defaultChecked={choices.includes(unit.id)} /> {unit.code} · {unit.title}</label>
          ))}
          <button className="action" type="submit">Simuler</button>
        </form>
        {plan && (
          <div role="status" className="card-note">
            <ul>{plan.periods.map(period => <li key={period.ordinal}>{period.label} : {period.credits} {version.creditUnit} ({period.units.join(', ')})</li>)}</ul>
            <p><strong>Total : {plan.total} {version.creditUnit}</strong></p>
            {plan.issues.length === 0 ? <p>Ce plan respecte la maquette.</p> :
              <ul>{plan.issues.map((issue, index) => <li key={index}>{issueMessages[issue.code]}{issue.subject ? ' : ' + issue.subject : ''}</li>)}</ul>}
          </div>
        )}
      </section>
      {sheet.program.labels.length > 0 && <section><h2>Autres langues</h2>
        <ul>{sheet.program.labels.map(label => <li key={label.language} lang={label.language}>{label.title}{label.summary ? ' — ' + label.summary : ''}</li>)}</ul></section>}
      <p className="muted">Version publiée le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(version.publishedAt))}.</p>
    </main>
  );
}
