import {
  type CommandConfirmationModalResult,
  type OpenCommandConfirmationModalFunction,
} from 'searm-sdk/front-component';
import { CustomError } from 'searm-shared/utils';
import { type FrontComponentHostCommunicationApi } from '@/types/FrontComponentHostCommunicationApi';

type CommandConfirmationModalPromiseCallbacks = {
  resolve: (result: CommandConfirmationModalResult) => void;
  reject: (error: Error) => void;
};

let pendingCommandConfirmationModalPromiseCallbacks: CommandConfirmationModalPromiseCallbacks | null =
  null;

const clearPendingCommandConfirmationModalPromiseCallbacks = () => {
  pendingCommandConfirmationModalPromiseCallbacks = null;
};

export const createOpenCommandConfirmationModalAdapter = (
  hostApi: Pick<
    FrontComponentHostCommunicationApi,
    'openCommandConfirmationModal'
  >,
): OpenCommandConfirmationModalFunction => {
  return async (params: Parameters<OpenCommandConfirmationModalFunction>[0]) => {
    if (pendingCommandConfirmationModalPromiseCallbacks !== null) {
      throw new CustomError(
        'A confirmation modal is already pending for this front component',
        'FRONT_COMPONENT_CONFIRMATION_MODAL_ALREADY_PENDING',
      );
    }

    let rejectCommandConfirmationModalPromise: (
      error: Error,
    ) => void = () => {};

    const commandConfirmationModalResultPromise =
      new Promise<CommandConfirmationModalResult>((resolve, reject) => {
        rejectCommandConfirmationModalPromise = reject;
        pendingCommandConfirmationModalPromiseCallbacks = { resolve, reject };
      });

    try {
      await hostApi.openCommandConfirmationModal(params);
    } catch (error) {
      clearPendingCommandConfirmationModalPromiseCallbacks();

      rejectCommandConfirmationModalPromise(
        error instanceof Error ? error : new Error(String(error)),
      );
    }

    return commandConfirmationModalResultPromise;
  };
};

export const handleCommandConfirmationModalResult = async (
  result: CommandConfirmationModalResult,
) => {
  if (pendingCommandConfirmationModalPromiseCallbacks === null) {
    return;
  }

  const currentCommandConfirmationModalPromiseCallbacks =
    pendingCommandConfirmationModalPromiseCallbacks;
  clearPendingCommandConfirmationModalPromiseCallbacks();
  currentCommandConfirmationModalPromiseCallbacks.resolve(result);
};
