import { BadRequestException } from '@nestjs/common';

import { type QueryFailedError } from 'typeorm';

import { CommonQueryRunnerException } from 'src/engine/api/common/common-query-runners/errors/common-query-runner.exception';
import { commonQueryRunnerToRestApiExceptionHandler } from 'src/engine/api/common/common-query-runners/utils/common-query-runner-to-rest-api-exception-handler.util';
import { RestInputRequestParserException } from 'src/engine/api/rest/input-request-parsers/rest-input-request-parser.exception';
import { ThrottlerException } from 'src/engine/core-modules/throttler/throttler.exception';
import { throttlerToRestApiExceptionHandler } from 'src/engine/core-modules/throttler/utils/throttler-to-rest-api-exception-handler.util';
import {
  SearmORMException,
  SearmORMExceptionCode,
} from 'src/engine/searm-orm/exceptions/searm-orm.exception';

interface QueryFailedErrorWithCode extends QueryFailedError {
  code: string;
}

export const workspaceQueryRunnerRestApiExceptionHandler = (
  error: QueryFailedErrorWithCode,
): never => {
  switch (true) {
    case error instanceof CommonQueryRunnerException:
      return commonQueryRunnerToRestApiExceptionHandler(error);
    case error instanceof RestInputRequestParserException:
      throw new BadRequestException(error.message);
    case error instanceof ThrottlerException:
      return throttlerToRestApiExceptionHandler(error);
    case error instanceof SearmORMException &&
      error.code === SearmORMExceptionCode.INVALID_INPUT:
      throw new BadRequestException(error.message);
    default:
      throw error;
  }
};
