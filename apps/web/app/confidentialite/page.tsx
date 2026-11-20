import type { Metadata } from 'next';
import { SiteTextPage } from '../site-text';

export const metadata: Metadata = { title: 'Confidentialité et données personnelles' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <SiteTextPage field="privacy_notice" title="Confidentialité et données personnelles" />;
}
