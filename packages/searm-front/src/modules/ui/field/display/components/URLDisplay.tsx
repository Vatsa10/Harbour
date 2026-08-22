import { type MouseEvent } from 'react';

import { RoundedLink, SocialLink } from 'searm-ui/navigation';
import { checkUrlType } from '~/utils/checkUrlType';
import { isSocialLinkType } from '~/utils/isSocialLinkType';
import { getSafeUrl } from 'searm-shared/utils';
import { EllipsisDisplay } from './EllipsisDisplay';

type URLDisplayProps = {
  value: string | null;
};

export const URLDisplay = ({ value }: URLDisplayProps) => {
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  const absoluteUrl = value ? (getSafeUrl(value) ?? '') : '';

  const displayedValue = value ?? '';

  const type = checkUrlType(absoluteUrl);

  if (isSocialLinkType(type)) {
    return (
      <EllipsisDisplay>
        <SocialLink
          href={absoluteUrl}
          onClick={handleClick}
          type={type}
          label={null}
        />
      </EllipsisDisplay>
    );
  }
  return (
    <EllipsisDisplay>
      <RoundedLink
        href={absoluteUrl}
        onClick={handleClick}
        label={displayedValue}
      />
    </EllipsisDisplay>
  );
};
