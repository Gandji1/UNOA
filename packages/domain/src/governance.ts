// Councils (module GOV): quorum and majority rules, configured per council.
// Pure functions, shared by the API and the tests.

export type Majority = 'simple' | 'absolute' | 'two_thirds';
export interface Tally { for: number; against: number; abstain: number }

export const majorityLabels: Record<Majority, string> = {
  simple: 'Majorité simple (plus de pour que de contre)',
  absolute: 'Majorité absolue (plus de la moitié des votants présents)',
  two_thirds: 'Majorité des deux tiers des suffrages exprimés',
};

// Quorum: present voting members over voting members in office, in percent.
export function quorumReached(present: number, inOffice: number, quorumPercent: number) {
  if (inOffice <= 0) return false;
  return present * 100 >= inOffice * quorumPercent;
}

export function requiredPresent(inOffice: number, quorumPercent: number) {
  return Math.ceil((inOffice * quorumPercent) / 100);
}

// Outcome of a vote; abstentions are counted but never as votes for.
export function outcome(rule: Majority, tally: Tally, presentVoters: number): 'adopted' | 'rejected' {
  const expressed = tally.for + tally.against;
  if (rule === 'simple') return tally.for > tally.against ? 'adopted' : 'rejected';
  if (rule === 'absolute') return tally.for * 2 > presentVoters ? 'adopted' : 'rejected';
  return expressed > 0 && tally.for * 3 >= expressed * 2 ? 'adopted' : 'rejected';
}
