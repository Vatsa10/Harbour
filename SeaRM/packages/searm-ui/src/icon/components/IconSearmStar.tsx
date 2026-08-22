import IconSearmStarRaw from '@assets/icons/searm-star.svg?react';
import { type IconComponentProps } from '@ui/icon/types/IconComponent';
import { useTheme } from '@ui/theme-constants';

type IconSearmStarProps = Pick<IconComponentProps, 'size' | 'stroke'>;

export const IconSearmStar = (props: IconSearmStarProps) => {
  const theme = useTheme();
  const size = props.size ?? 24;
  const stroke = props.stroke ?? theme.icon.stroke.md;

  return <IconSearmStarRaw height={size} width={size} strokeWidth={stroke} />;
};
