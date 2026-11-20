export const applicationStates: Record<string, [string, 'ok' | 'warn' | 'muted' | 'info' | 'danger']> = {
  draft: ['Brouillon', 'warn'], submitted: ['Déposée', 'info'], incomplete: ['Complément demandé', 'warn'],
  review: ['En instruction', 'info'], decided: ['Décision rendue', 'ok'], accepted: ['Admission acceptée', 'ok'],
  declined: ['Admission déclinée', 'muted'], withdrawn: ['Retirée', 'muted'],
};
export const decisionLabels: Record<string, string> = {
  admitted: 'Admis', conditional: 'Admis sous conditions', waitlisted: 'Liste d’attente', refused: 'Non admis',
};
export const documentStates: Record<string, [string, 'ok' | 'warn' | 'muted' | 'info' | 'danger']> = {
  deposited: ['Déposée', 'info'], verified: ['Vérifiée', 'ok'], rejected: ['Rejetée', 'danger'], replaced: ['Remplacée', 'muted'],
};
