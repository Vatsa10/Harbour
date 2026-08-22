import { getCommunityStats } from '@/platform/community';
import {
  getRouteI18n,
  type LocaleRouteParams,
} from '@/platform/i18n/get-route-i18n';
import { resolveLocaleParam } from '@/platform/i18n/resolve-locale-param';
import {
  buildBreadcrumbListJsonLd,
  buildRouteMetadata,
  JsonLd,
} from '@/platform/seo';
import { Menu } from '@/sections/menu';
import { WhySearmEditorials } from '@/sections/why-searm-editorial';
import { WhySearmHero } from '@/sections/why-searm-hero';
import { WhySearmMarquee } from '@/sections/why-searm-marquee';
import { WhySearmSignoff } from '@/sections/why-searm-signoff';

export const generateMetadata = buildRouteMetadata('whySeaRM');

export default async function WhySearmPage({
  params,
}: {
  params: Promise<LocaleRouteParams>;
}) {
  const [, communityStats] = await Promise.all([
    getRouteI18n(params),
    getCommunityStats(),
  ]);
  const locale = resolveLocaleParam((await params).locale);

  return (
    <>
      <JsonLd
        data={buildBreadcrumbListJsonLd(
          [
            { name: 'Home', path: '/' },
            { name: 'Why SeaRM', path: '/why-searm' },
          ],
          locale,
        )}
      />
      <Menu communityStats={communityStats} scheme="dark" />
      <main>
        <WhySearmHero />
        <WhySearmEditorials />
        <WhySearmMarquee />
        <WhySearmSignoff />
      </main>
    </>
  );
}
