import { NextResponse, type NextRequest } from 'next/server';
import { documentFormats } from '@unoa/domain/forms';
import { studioGet } from '@/lib/server/route';
import { documentContent } from '@/lib/admissions/store';

type RouteContext = { params: Promise<{ id: string }> };
const options = { path: '/api/v1/admissions-documents', studio: '/administration/admissions', denial: 'adm.access', label: 'adm' };

// Pieces are always served as attachments with their verified type, never inline.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  let file: Awaited<ReturnType<typeof documentContent>> | null = null;
  const refused = await studioGet(request, [id], options, async ({ settings, actor }) => {
    file = await documentContent(settings, actor, id);
    return {};
  });
  if (!file) return refused;
  const found = file as Awaited<ReturnType<typeof documentContent>>;
  return new NextResponse(new Uint8Array(found.content), {
    headers: {
      'Content-Type': documentFormats[found.format]?.mime ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${found.filename.replace(/[^\w.\-]/g, '_')}"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
    },
  });
}
