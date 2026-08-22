import { getTokenPair } from '@/apollo/utils/getTokenPair';
import { isDefined } from 'searm-shared/utils';

export const hasTokenPair = () => {
  const tokenPair = getTokenPair();
  return isDefined(tokenPair);
};
