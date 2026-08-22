import { type CodeExecutionData } from 'searm-shared/ai';

export type CodeExecutionStreamEmitter = (data: CodeExecutionData) => void;
