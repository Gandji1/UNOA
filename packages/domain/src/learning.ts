// Learning rules shared by the server and the tests: a restricted markup that
// never carries HTML, and access gating for sequential or conditional lessons.

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string };

export type Block =
  | { type: 'heading'; level: 2 | 3 | 4; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; items: Inline[][] }
  | { type: 'image'; src: string; alt: string; caption: string | null }
  | { type: 'callout'; tone: 'info' | 'key' | 'warn'; inlines: Inline[] };

// Images: HTTPS or a path of the platform's own illustrations; the description is required.
const imagePattern = /^!\[([^\]]{3,200})\]\(((?:https:\/\/|\/)[^\s)]+)(?:\s+"([^"]{1,200})")?\)$/;
const calloutPattern = /^>\s*(?:\[(info|cle|attention)\]\s*)?(.+)$/;

const inlinePattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > last) result.push({ type: 'text', value: text.slice(last, match.index) });
    if (match[1] !== undefined) result.push({ type: 'strong', value: match[1] });
    else if (match[2] !== undefined) result.push({ type: 'em', value: match[2] });
    else if (match[3] !== undefined) result.push({ type: 'code', value: match[3] });
    else result.push({ type: 'link', value: match[4], href: match[5] });
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push({ type: 'text', value: text.slice(last) });
  return result;
}

// Every character is rendered as text by the caller: tags such as <script>
// remain visible characters, never markup.
export function parseMarkup(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) });
    paragraph = [];
    if (list) blocks.push({ type: 'list', items: list });
    list = null;
  };
  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (!line) { flush(); continue; }
    const image = imagePattern.exec(line);
    if (image && !image[2].startsWith('//')) {
      flush();
      blocks.push({ type: 'image', alt: image[1], src: image[2], caption: image[3] ?? null });
      continue;
    }
    const callout = calloutPattern.exec(line);
    if (callout) {
      flush();
      blocks.push({ type: 'callout', tone: callout[1] === 'cle' ? 'key' : callout[1] === 'attention' ? 'warn' : 'info', inlines: parseInline(callout[2]) });
      continue;
    }
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: (heading[1].length + 1) as 2 | 3 | 4, inlines: parseInline(heading[2]) });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (paragraph.length) { blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) }); paragraph = []; }
      (list ??= []).push(parseInline(line.replace(/^[-*]\s+/, '')));
      continue;
    }
    if (list) { blocks.push({ type: 'list', items: list }); list = null; }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

export interface GatedLesson { id: string; requires: string | null }
export interface GatedModule { accessMode: 'free' | 'sequential'; lessons: GatedLesson[] }
export type Access = { open: true } | { open: false; reason: 'sequence' | 'condition' };

export function lessonAccess(modules: GatedModule[], completed: Set<string>): Map<string, Access> {
  const access = new Map<string, Access>();
  for (const module of modules) {
    let previousDone = true;
    for (const lesson of module.lessons) {
      if (lesson.requires && !completed.has(lesson.requires)) access.set(lesson.id, { open: false, reason: 'condition' });
      else if (module.accessMode === 'sequential' && !previousDone) access.set(lesson.id, { open: false, reason: 'sequence' });
      else access.set(lesson.id, { open: true });
      previousDone = previousDone && completed.has(lesson.id);
    }
  }
  return access;
}

export interface Chapter { at: number; title: string }

// Chapters are written one per line as "mm:ss Title" or "hh:mm:ss Title".
export function parseChapters(source: string): Chapter[] | null {
  const chapters: Chapter[] = [];
  for (const line of source.split(/\r?\n/).map(item => item.trim()).filter(Boolean)) {
    const match = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.{1,160})$/.exec(line);
    if (!match || Number(match[3]) > 59 || (match[1] !== undefined && Number(match[2]) > 59)) return null;
    chapters.push({ at: Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), title: match[4] });
  }
  if (chapters.length > 200 || chapters.some((item, index) => index > 0 && item.at <= chapters[index - 1].at)) return null;
  return chapters;
}

export const formatOffset = (seconds: number) =>
  [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
