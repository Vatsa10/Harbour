import { useMediaQuery } from 'react-responsive';
import { MOBILE_VIEWPORT } from 'searm-ui/theme-constants';

export const useIsMobile = () =>
  useMediaQuery({ query: `(max-width: ${MOBILE_VIEWPORT}px)` });
