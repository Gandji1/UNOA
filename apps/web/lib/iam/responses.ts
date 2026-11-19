import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export function redirectTo(url: URL) {
  return NextResponse.redirect(url, { status: 303, headers });
}

export function privateJson(body: object) {
  return NextResponse.json(body, { headers });
}

export function problem(status: number, title: string, instance: string, correlationId = randomUUID()) {
  return NextResponse.json({
    type: 'about:blank', title, status, detail: title, instance, correlationId,
  }, {
    status,
    headers: { ...headers, 'Content-Type': 'application/problem+json' },
  });
}

export function unavailable(instance: string) {
  return problem(503, 'Connexion institutionnelle indisponible', instance);
}
