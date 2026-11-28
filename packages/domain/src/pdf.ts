// Minimal text PDF (A4, Helvetica, WinAnsi encoding) for documents that people
// download and keep, such as CV versions. No external dependency, no script,
// no remote resource: only text lines, headings and automatic pages.

export interface PdfLine { text: string; size?: number; bold?: boolean; gap?: number }

// WinAnsi (CP1252) code points above 0x7F that differ from Latin-1.
const cp1252: Record<string, number> = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

function encode(text: string) {
  const bytes: number[] = [];
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0)!;
    const byte = cp1252[char] ?? (code === 0x202f || code === 0xa0 ? 0x20 : code < 0x100 && (code >= 0x20 && code < 0x7f || code >= 0xa0) ? code : 0x3f);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c);
    bytes.push(byte);
  }
  return bytes;
}

function wrap(text: string, size: number) {
  const width = Math.floor(95 * 10 / size);
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if ((current + ' ' + word).trim().length > width && current) { lines.push(current); current = word; }
      else current = (current + ' ' + word).trim();
    }
    lines.push(current);
  }
  return lines;
}

export function textPdf(title: string, content: PdfLine[]): Uint8Array {
  const pages: number[][][] = [];
  let stream: number[][] = [];
  let y = 800;
  const ascii = (value: string) => [...value].map(char => char.charCodeAt(0));
  for (const line of content) {
    const size = line.size ?? 11;
    y -= line.gap ?? 0;
    for (const part of wrap(line.text, size)) {
      if (y < 60) { pages.push(stream); stream = []; y = 800; }
      stream.push([...ascii(`BT /${line.bold ? 'F2' : 'F1'} ${size} Tf 56 ${y} Td (`), ...encode(part), ...ascii(') Tj ET\n')]);
      y -= size * 1.45;
    }
  }
  pages.push(stream);
  const objects: number[][] = [];
  const pageIds = pages.map((_, index) => 5 + index * 2);
  objects[1] = ascii('<< /Type /Catalog /Pages 2 0 R >>');
  objects[2] = ascii(`<< /Type /Pages /Kids [${pageIds.map(id => id + ' 0 R').join(' ')}] /Count ${pages.length} >>`);
  objects[3] = ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects[4] = ascii('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((lines, index) => {
    const body = lines.flat();
    objects[pageIds[index]] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`);
    objects[pageIds[index] + 1] = [...ascii(`<< /Length ${body.length} >>\nstream\n`), ...body, ...ascii('\nendstream')];
  });
  const info = objects.length;
  objects[info] = [...ascii('<< /Title ('), ...encode(title), ...ascii(') /Producer (UNOA) >>')];
  const out: number[] = [...ascii('%PDF-1.4\n%'), 0xe2, 0xe3, 0xcf, 0xd3, 0x0a];
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out.push(...ascii(`${id} 0 obj\n`), ...objects[id], ...ascii('\nendobj\n'));
  }
  const xref = out.length;
  out.push(...ascii(`xref\n0 ${objects.length}\n0000000000 65535 f \n`));
  for (let id = 1; id < objects.length; id++) out.push(...ascii(String(offsets[id]).padStart(10, '0') + ' 00000 n \n'));
  out.push(...ascii(`trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Uint8Array(out);
}
