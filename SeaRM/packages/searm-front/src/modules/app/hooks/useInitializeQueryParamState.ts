import { useCallback } from 'react';

import { returnToPathState } from '@/auth/states/returnToPathState';
import { isValidReturnToPath } from '@/auth/utils/isValidReturnToPath';
import { useStore } from 'jotai';

export const useInitializeQueryParamState = () => {
  const store = useStore();
  const initializeQueryParamState = useCallback(() => {
    const handlers: Record<string, (value: string) => void> = {
      returnToPath: (value: string) => {
        if (isValidReturnToPath(value)) {
          store.set(returnToPathState.atom, value);
        }
      },
    };

    const queryParams = new URLSearchParams(window.location.search);

    for (const [paramName, handler] of Object.entries(handlers)) {
      const value = queryParams.get(paramName);
      if (value !== null) {
        handler(value);
      }
    }
  }, [store]);

  return { initializeQueryParamState };
};
