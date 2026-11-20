import 'server-only';
import { NextResponse } from 'next/server';

// Public data is already filtered by the database; a short cache keeps the
// directory usable on slow connections without serving stale decisions for long.
export function publicJson(body: object) {
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=60', 'Referrer-Policy': 'no-referrer' } });
}

export const regulatoryLabels: Record<string, string> = {
  unverified: 'Statut réglementaire non vérifié',
  preparation: 'En préparation',
  non_degree: 'Non diplômant',
  conditional: 'Autorisé sous conditions',
  authorized: 'Diplômant habilité',
  suspended: 'Suspendu',
  expired: 'Expiré',
};
