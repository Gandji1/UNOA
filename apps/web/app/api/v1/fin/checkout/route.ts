import type { NextRequest } from 'next/server';
import { studioPost } from '@/lib/server/route';
import { startPayment } from '@/lib/finance/store';

// Starting a payment sends the payer to the provider's checkout; nothing is credited here.
const options = {
  path: '/api/v1/fin/checkout', studio: '/paiement/sandbox', denial: 'fin.access', label: 'fin',
  view: (_input: Record<string, unknown>, result: Record<string, unknown> | null) => typeof result?.ref === 'string' ? { ref: result.ref } : {} as Record<string, string>,
};

export async function POST(request: NextRequest) {
  return studioPost(request, [], options, ({ settings, actor, correlation }, input) => startPayment(settings, actor, input, correlation));
}
