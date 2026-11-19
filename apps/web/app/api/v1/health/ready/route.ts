// This initial web service serves the public landing page without external dependencies.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({service:'web',status:'ready'}, {headers:{'Cache-Control':'no-store'}});
}
