import { getServerI18n } from '@/platform/i18n/get-server-i18n';

import { Editorial } from './Editorial';
import { WHY_SEARM_EDITORIALS } from './editorials.data';

export function WhySearmEditorials() {
  const i18n = getServerI18n();

  return (
    <>
      {WHY_SEARM_EDITORIALS.map((editorial) => (
        <Editorial
          align={editorial.align}
          eyebrow={i18n._(editorial.eyebrow)}
          heading={i18n._(editorial.heading)}
          key={editorial.id}
          paragraphs={[
            i18n._(editorial.paragraphs[0]),
            i18n._(editorial.paragraphs[1]),
          ]}
        />
      ))}
    </>
  );
}
