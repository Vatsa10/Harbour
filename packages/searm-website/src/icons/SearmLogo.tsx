import { styled } from '@linaria/react';

import { DURATION, EASING, semanticColor } from '@/tokens';

// Restrained, geometric anchor mark: a ring, a shank and two curved flukes.
const LogoSvg = styled.svg`
  rect,
  circle,
  path {
    transition:
      fill ${DURATION.md} ${EASING.gentle},
      stroke ${DURATION.md} ${EASING.gentle};
  }
`;

export type SearmLogoProps = {
  sizePx?: number;
};

export function SearmLogo({ sizePx = 40 }: SearmLogoProps) {
  return (
    <LogoSvg
      fill="none"
      height={sizePx}
      viewBox="0 0 40 40"
      width={sizePx}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill={semanticColor.ink} height={40} rx={4} width={40} />
      <g
        fill="none"
        stroke={semanticColor.surface}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx={20} cy={10} r={3} strokeWidth={2.6} />
        <path d="M20 13 V24" />
        <path d="M13 17 H27" />
        <path d="M20 24 C20 30 13 31 10 26" />
        <path d="M20 24 C20 30 27 31 30 26" />
      </g>
    </LogoSvg>
  );
}
