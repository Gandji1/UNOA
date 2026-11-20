import type { Metadata } from 'next';
import { SiteTextPage } from '../site-text';

export const metadata: Metadata = { title: 'À propos' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <SiteTextPage field="about" title="À propos" />;
}
