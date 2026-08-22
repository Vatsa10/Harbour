import { type DynamicModule, Global } from '@nestjs/common';

import { CodeInterpreterDriverFactory } from 'src/engine/core-modules/code-interpreter/code-interpreter-driver.factory';
import { CodeInterpreterService } from 'src/engine/core-modules/code-interpreter/code-interpreter.service';
import { SearmConfigModule } from 'src/engine/core-modules/searm-config/searm-config.module';

@Global()
export class CodeInterpreterModule {
  static forRoot(): DynamicModule {
    return {
      module: CodeInterpreterModule,
      imports: [SearmConfigModule],
      providers: [CodeInterpreterDriverFactory, CodeInterpreterService],
      exports: [CodeInterpreterService],
    };
  }
}
