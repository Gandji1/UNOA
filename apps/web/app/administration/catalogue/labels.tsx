import { Badge } from '../forms';
import { regulatoryLabels } from '@/lib/catalog/public';

export const stateLabels: Record<string, [string, 'ok' | 'warn' | 'muted' | 'info' | 'danger']> = {
  draft: ['Brouillon', 'warn'], review: ['En revue', 'info'], approved: ['Approuvée', 'info'],
  published: ['Publiée', 'ok'], retired: ['Remplacée', 'muted'],
};

export function stateBadge(state: string) {
  const [label, tone] = stateLabels[state] ?? [state, 'muted'];
  return <Badge tone={tone}>{label}</Badge>;
}

const regulatoryTones: Record<string, 'ok' | 'warn' | 'muted' | 'info' | 'danger'> = {
  unverified: 'muted', preparation: 'warn', non_degree: 'info', conditional: 'warn',
  authorized: 'ok', suspended: 'danger', expired: 'danger',
};

export function regulatoryBadge(status: string) {
  return <Badge tone={regulatoryTones[status] ?? 'muted'}>{regulatoryLabels[status] ?? status}</Badge>;
}

export const requirementLabels: Record<string, string> = {
  internship: 'Stage', thesis: 'Mémoire', defense: 'Soutenance', project: 'Projet', other: 'Autre',
};
