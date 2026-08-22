import IconSearmStarFilledRaw from '@assets/icons/searm-star-filled.svg?react';
import { type IconComponentProps } from '@ui/icon/types/IconComponent';
import { useTheme } from '@ui/theme-constants';

type IconSearmStarFilledProps = Pick<IconComponentProps, 'size' | 'stroke'>;

export const IconSearmStarFilled = (props: IconSearmStarFilledProps) => {
  const theme = useTheme();
  const size = props.size ?? 24;
  const stroke = props.stroke ?? theme.icon.stroke.md;

  return (
    <IconSearmStarFilledRaw height={size} width={size} strokeWidth={stroke} />
  );
};
