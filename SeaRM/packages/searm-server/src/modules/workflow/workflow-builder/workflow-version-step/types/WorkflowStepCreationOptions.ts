import { type WorkflowActionType } from 'searm-shared/workflow';

type WorkflowIteratorStepConnectionOptions = {
  connectedStepType: WorkflowActionType.ITERATOR;
  settings: {
    isConnectedToLoop: boolean;
  };
};

export type WorkflowStepConnectionOptions =
  WorkflowIteratorStepConnectionOptions;
