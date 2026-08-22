import { useNavigate } from 'react-router-dom';
import { type AppPath, type NavigateOptions } from 'searm-shared/types';
import { getAppPath } from 'searm-shared/utils';

export const useNavigateApp = () => {
  const navigate = useNavigate();

  return <T extends AppPath>(
    to: T,
    params?: Parameters<typeof getAppPath<T>>[1],
    queryParams?: Record<string, any>,
    options?: NavigateOptions,
  ) => {
    const path = getAppPath(to, params, queryParams);
    return navigate(path, options);
  };
};
