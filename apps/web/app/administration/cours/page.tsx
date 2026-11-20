import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { formatOffset } from '@unoa/domain/learning';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { courseDetails, courseVersionDetails, lmsContexts, lmsOverview } from '@/lib/lms/studio';
import { Markup } from '@/lib/lms/markup';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';

export const metadata: Metadata = { title: 'Studio des cours' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/cours';
const api = '/api/v1/lms/';
const kindLabels: Record<string, string> = {
  page: 'Page', video: 'Vidéo', audio: 'Audio', document: 'Document', link: 'Lien', activity: 'Activité',
};
const states: Record<string, [string, 'ok' | 'warn' | 'muted' | 'info']> = {
  draft: ['Brouillon', 'warn'], review: ['En revue', 'info'], published: ['Publiée', 'ok'], retired: ['Remplacée', 'muted'],
};
const State = ({ state }: { state: string }) => <Badge tone={states[state][1]}>{states[state][0]}</Badge>;

function refused(error: unknown) {
  if (error instanceof Problem) return null;
  throw error;
}

export default async function Studio({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const denied = <main id="contenu" className="studio"><section className="studio-panel"><h1>Studio des cours</h1>{notice}
    <p>Élément inaccessible avec vos habilitations.</p><p><a href={path}>Revenir au studio</a></p></section></main>;

  const versionId = field(search.version);
  if (scopeIdFormat.test(versionId)) {
    const data = await courseVersionDetails(settings, actor, versionId).catch(refused);
    if (!data) return denied;
    const { version, course, rights, modules, lessons } = data;
    const back = `${path}?version=${version.id}`;
    const editable = version.state === 'draft' && rights.write;
    const action = (part: string) => `${api}course-versions/${version.id}/${part}`;
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <a href={path}>Studio des cours</a> ›{' '}
          <a href={`${path}?course=${course.id}`}>{course.code}</a> › <span aria-current="page">v{version.number} ({version.language})</span></nav>
        <section className="studio-heading">
          <p className="eyebrow">{course.code} · version {version.number} · {version.language}</p>
          <h1>{version.title}</h1>
          <p><State state={version.state} />{version.variant_of && <Badge tone="info">Variante : {version.variant_note}</Badge>}</p>
        </section>
        {notice}
        <Panel title="Syllabus" id="syllabus">
          <h3>Objectifs</h3><p>{version.objectives}</p>
          {version.prerequisites && <><h3>Prérequis</h3><p>{version.prerequisites}</p></>}
          {version.methods && <><h3>Méthodes</h3><p>{version.methods}</p></>}
          {version.bibliography && <><h3>Bibliographie</h3><p>{version.bibliography}</p></>}
          {version.expected_hours && <p className="muted">Temps prévu : {Number(version.expected_hours)} h</p>}
          {editable && (
            <Editor summary="Modifier le syllabus">
              <ActionForm action={action('update')} back={back} submit="Enregistrer">
                <label className="studio-wide">Intitulé<input name="title" required maxLength={200} defaultValue={version.title} /></label>
                <label className="studio-wide">Objectifs<textarea name="objectives" required maxLength={4000} defaultValue={version.objectives} /></label>
                <label className="studio-wide">Prérequis<textarea name="prerequisites" maxLength={2000} defaultValue={version.prerequisites ?? ''} /></label>
                <label className="studio-wide">Méthodes<textarea name="methods" maxLength={2000} defaultValue={version.methods ?? ''} /></label>
                <label className="studio-wide">Bibliographie<textarea name="bibliography" maxLength={4000} defaultValue={version.bibliography ?? ''} /></label>
                <label>Heures prévues<input type="number" name="expectedHours" min={0.5} step="0.5" defaultValue={version.expected_hours ?? ''} /></label>
              </ActionForm>
            </Editor>
          )}
        </Panel>

        <Panel title="Modules et leçons" id="modules">
          {modules.length === 0 && <p>Aucun module.</p>}
          {modules.map(module => (
            <section key={module.id} className="period">
              <div className="panel-head"><h3>{module.ordinal}. {module.title}</h3>
                <Badge tone={module.access_mode === 'sequential' ? 'info' : 'muted'}>{module.access_mode === 'sequential' ? 'accès séquentiel' : 'accès libre'}</Badge>
                {editable && !lessons.some(lesson => lesson.module_id === module.id) &&
                  <ActionForm inline action={action('remove')} back={back} hidden={{ kind: 'module', itemId: module.id }} submit="Retirer" />}
              </div>
              {module.summary && <p className="muted">{module.summary}</p>}
              <ol className="lesson-list">
                {lessons.filter(lesson => lesson.module_id === module.id).map(lesson => (
                  <li key={lesson.id}>
                    <details>
                      <summary>{lesson.title} <Badge tone="muted">{kindLabels[lesson.kind]}</Badge>
                        {lesson.requires_lesson_id && <Badge tone="warn">conditionnelle</Badge>}
                        {lesson.captions_url && <Badge tone="info">sous-titres</Badge>}</summary>
                      {lesson.body && <Markup source={lesson.body} />}
                      {lesson.media_url && <p><a href={lesson.media_url} rel="noopener noreferrer">{lesson.media_url}</a></p>}
                      {lesson.chapters.length > 0 && <ul>{lesson.chapters.map(item => <li key={item.at}>{formatOffset(item.at)} {item.title}</li>)}</ul>}
                      <p className="muted">Droits : {lesson.rights}{lesson.downloadable ? ' · téléchargement permis' : ''}</p>
                      {editable && <ActionForm inline action={action('remove')} back={back} hidden={{ kind: 'lesson', itemId: lesson.id }} submit="Retirer la leçon" />}
                    </details>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {editable && (
            <div className="editor-grid">
              <Editor summary="Ajouter un module">
                <ActionForm action={action('modules')} back={back} submit="Ajouter">
                  <label>Rang<input type="number" name="ordinal" required min={1} defaultValue={modules.length + 1} /></label>
                  <label>Accès<select name="accessMode"><option value="free">Libre</option><option value="sequential">Séquentiel</option></select></label>
                  <label className="studio-wide">Titre<input name="title" required maxLength={200} /></label>
                  <label className="studio-wide">Résumé<textarea name="summary" maxLength={2000} /></label>
                </ActionForm>
              </Editor>
              {modules.length > 0 && (
                <Editor summary="Ajouter une leçon, une ressource ou une activité">
                  <ActionForm action={action('lessons')} back={back} submit="Ajouter"
                    confirm="Texte : # titre, - liste, **gras**, *italique*, [lien](https://…). Le HTML n’est jamais interprété.">
                    <label>Module<select name="moduleId">{modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>
                    <label>Rang<input type="number" name="ordinal" required min={1} defaultValue={1} /></label>
                    <label>Nature<select name="kind">{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Titre<input name="title" required maxLength={200} /></label>
                    <label className="studio-wide">Contenu ou consigne<textarea name="body" maxLength={60000} rows={6} /></label>
                    <label className="studio-wide">Média (HTTPS : vidéo MP4/HLS, audio, PDF, DOCX, PPTX, EPUB…)<input name="mediaUrl" type="url" maxLength={2000} /></label>
                    <label>Sous-titres WebVTT (HTTPS)<input name="captionsUrl" type="url" maxLength={2000} /></label>
                    <label>Langue des sous-titres<input name="captionsLanguage" maxLength={6} /></label>
                    <label className="studio-wide">Chapitres (une ligne « mm:ss Titre »)<textarea name="chapters" maxLength={8000} /></label>
                    <label className="studio-wide">Transcription<textarea name="transcript" maxLength={60000} /></label>
                    <label>Durée (minutes)<input type="number" name="expectedMinutes" min={1} /></label>
                    <label>Exige la leçon<select name="requiresLessonId" defaultValue=""><option value="">— aucune —</option>
                      {lessons.map(lesson => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</select></label>
                    <label className="studio-wide">Droits et licence<input name="rights" required maxLength={500} placeholder="Auteur, licence, autorisation de diffusion" /></label>
                    <label className="studio-checkbox"><input type="checkbox" name="downloadable" /> Téléchargement permis</label>
                  </ActionForm>
                </Editor>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Validation et diffusion" id="validation">
          {version.review_note && <p className="studio-notice">Observation : {version.review_note}</p>}
          <div className="studio-actions">
            {editable && <ActionForm inline action={action('submit')} back={back} submit="Soumettre à la validation" />}
            <a className="secondary" href={`${api}course-versions/${version.id}/export`} download>Exporter (JSON)</a>
          </div>
          {version.state === 'review' && rights.review && version.author_id !== actor && (
            <div className="editor-grid">
              <ActionForm action={action('review')} back={back} hidden={{ decision: 'approve' }} submit="Valider et publier">
                <label className="studio-checkbox"><input type="checkbox" name="discipline" required /> Contrôle disciplinaire effectué</label>
                <label className="studio-checkbox"><input type="checkbox" name="pedagogy" required /> Contrôle pédagogique et accessibilité effectué</label>
                <label className="studio-checkbox"><input type="checkbox" name="rights" required /> Droits d’auteur et de diffusion vérifiés</label>
                <label className="studio-wide">Observation<input name="note" maxLength={1000} /></label>
              </ActionForm>
              <ActionForm action={action('review')} back={back} hidden={{ decision: 'reject' }} submit="Renvoyer à l’auteur">
                <label className="studio-wide">Motif<textarea name="note" required maxLength={1000} /></label>
              </ActionForm>
            </div>
          )}
          {(version.state === 'published' || version.state === 'retired') && rights.write && (
            <Editor summary="Préparer une nouvelle édition ou une variante linguistique">
              <ActionForm action={action('derive')} back={`${path}?course=${course.id}`} submit="Créer le brouillon">
                <label>Langue (vide = même langue)<input name="language" maxLength={6} /></label>
                <label>Note de variante<input name="variantNote" maxLength={500} /></label>
              </ActionForm>
            </Editor>
          )}
          {version.state === 'published' && rights.manage && (
            <Editor summary="Ouvrir une offre pour une promotion">
              <ActionForm action={action('offerings')} back={`${path}?course=${course.id}`} submit="Créer l’offre">
                <label className="studio-wide">Promotion ou groupe<input name="label" required maxLength={200} /></label>
                <label>Fuseau horaire IANA<input name="timeZone" required maxLength={64} placeholder="Africa/Porto-Novo" /></label>
                <label>Début<input type="date" name="startsOn" required /></label>
                <label>Fin<input type="date" name="endsOn" required /></label>
              </ActionForm>
            </Editor>
          )}
        </Panel>
      </main>
    );
  }

  const courseId = field(search.course);
  if (scopeIdFormat.test(courseId)) {
    const data = await courseDetails(settings, actor, courseId).catch(refused);
    if (!data) return denied;
    const { course, rights, versions, offerings } = data;
    const back = `${path}?course=${course.id}`;
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <a href={`${path}?scope=${course.owner_scope_id}`}>Studio des cours</a> ›{' '}
          <span aria-current="page">{course.code}</span></nav>
        <section className="studio-heading"><p className="eyebrow">{course.owner_label}</p><h1>{course.title}</h1>
          <p>Le cours du catalogue est distinct de ses versions pédagogiques et de ses offres par promotion.</p></section>
        {notice}
        <Panel title="Versions pédagogiques" id="versions">
          {versions.length === 0 ? <p>Aucune version.</p> : (
            <Table label="Versions" head={['Version', 'Langue', 'Intitulé', 'État', 'Publication']}>
              {versions.map(version => (
                <tr key={version.id}><td><a href={`${path}?version=${version.id}`}>v{version.number}</a></td><td>{version.language}</td>
                  <td>{version.title}{version.variant_of && ' (variante)'}</td><td><State state={version.state} /></td>
                  <td>{version.published_at ? formatTime(version.published_at) : '—'}</td></tr>
              ))}
            </Table>
          )}
          {rights.write && (
            <>
              <Editor summary="Rédiger une nouvelle version">
                <ActionForm action={`${api}courses/${course.id}/versions`} back={back} submit="Créer le brouillon">
                  <label>Langue<input name="language" required maxLength={6} defaultValue="fr" /></label>
                  <label>Intitulé<input name="title" required maxLength={200} defaultValue={course.title} /></label>
                  <label className="studio-wide">Objectifs<textarea name="objectives" required maxLength={4000} /></label>
                  <label className="studio-wide">Prérequis<textarea name="prerequisites" maxLength={2000} /></label>
                  <label className="studio-wide">Méthodes<textarea name="methods" maxLength={2000} /></label>
                  <label className="studio-wide">Bibliographie<textarea name="bibliography" maxLength={4000} /></label>
                </ActionForm>
              </Editor>
              <p className="studio-help">Pour restaurer un export, envoyez son contenu JSON à <code>POST {api}courses/{course.id}/import</code>.</p>
            </>
          )}
        </Panel>
        <Panel title="Offres par promotion" id="offres">
          {offerings.length === 0 ? <p>Aucune offre.</p> : (
            <Table label="Offres" head={['Promotion', 'Version', 'Période', 'Fuseau', 'Membres', 'État']}>
              {offerings.map(item => (
                <tr key={item.id}><td><a href={`/apprendre/${item.id}`}>{item.label}</a></td><td>v{item.number}</td>
                  <td>{item.starts_on} → {item.ends_on}</td><td>{item.time_zone}</td><td>{item.members}</td>
                  <td>{item.state === 'open' ? <Badge tone="ok">ouverte</Badge> : <Badge tone="muted">close</Badge>}</td></tr>
              ))}
            </Table>
          )}
        </Panel>
      </main>
    );
  }

  const contexts = await lmsContexts(settings, actor);
  const requested = field(search.scope);
  const selected = scopeIdFormat.test(requested) ? requested : contexts[0]?.id;
  if (!selected) {
    return <main id="contenu" className="studio"><section className="studio-heading"><h1>Studio des cours</h1>
      <p>Aucune structure ne vous est attribuée pour la conception de cours.</p></section></main>;
  }
  const data = await lmsOverview(settings, actor, selected).catch(refused);
  if (!data) return denied;
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Studio des cours</span></nav>
      <section className="studio-heading"><p className="eyebrow">Studio pédagogique</p><h1>{data.scope.label}</h1>
        <p>Rédigez le syllabus, les modules, les leçons et les activités des cours du catalogue, faites-les valider puis offrez-les aux promotions.</p></section>
      {notice}
      <section className="studio-panel" aria-label="Choix de la structure">
        <form method="get" className="studio-form studio-filters">
          <label>Structure<select name="scope" defaultValue={selected}>{contexts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <button className="action" type="submit">Consulter</button>
        </form>
      </section>
      <Panel title="Cours" id="cours">
        {data.courses.length === 0 ? <p>Aucun cours dans cette structure. Créez-les dans le catalogue des formations.</p> : (
          <Table label="Cours" head={['Code', 'Intitulé', 'Versions', 'Offres']}>
            {data.courses.map(course => (
              <tr key={course.id}><td>{course.code}</td><td><a href={`${path}?course=${course.id}`}>{course.title}</a></td>
                <td>{course.versions.map(version => <span key={version.id} className="chip">v{version.number} {version.language} <State state={version.state} /></span>)}</td>
                <td>{course.offerings}</td></tr>
            ))}
          </Table>
        )}
      </Panel>
    </main>
  );
}
