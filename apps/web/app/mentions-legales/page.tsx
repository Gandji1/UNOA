import type { Metadata } from 'next';
import { SiteTextPage } from '../site-text';

export const metadata: Metadata = { title: 'Mentions légales' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <SiteTextPage field="legal_notice" title="Mentions légales" />;
}
