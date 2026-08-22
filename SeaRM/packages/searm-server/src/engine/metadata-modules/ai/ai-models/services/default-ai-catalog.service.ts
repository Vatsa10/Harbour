import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import { FileStorageDriverFactory } from 'src/engine/core-modules/file-storage/file-storage-driver.factory';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';
import defaultAiProviders from 'src/engine/metadata-modules/ai/ai-models/ai-providers.json';
import { aiProvidersConfigSchema } from 'src/engine/metadata-modules/ai/ai-models/types/ai-providers-config.schema';
import { type AiProvidersConfig } from 'src/engine/metadata-modules/ai/ai-models/types/ai-providers-config.type';
import { normalizeAiProviders } from 'src/engine/metadata-modules/ai/ai-models/utils/normalize-ai-providers.util';
import { streamToBuffer } from 'src/utils/stream-to-buffer';

@Injectable()
export class DefaultAiCatalogService implements OnModuleInit {
  private readonly logger = new Logger(DefaultAiCatalogService.name);
  private catalog: AiProvidersConfig = normalizeAiProviders(
    defaultAiProviders as AiProvidersConfig,
  );

  constructor(
    private readonly searmConfigService: SearmConfigService,
    private readonly fileStorageDriverFactory: FileStorageDriverFactory,
  ) {}

  async onModuleInit(): Promise<void> {
    const catalogPath = this.searmConfigService.get('AI_CATALOG_STORAGE_PATH');

    if (!catalogPath) {
      this.logger.log(
        'Using built-in AI catalog (AI_CATALOG_STORAGE_PATH not set)',
      );

      return;
    }

    try {
      const raw = await this.fetchCatalog(catalogPath);

      this.catalog = normalizeAiProviders(raw);
      this.logger.log(`Loaded AI catalog from storage: ${catalogPath}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Failed to load AI catalog from storage: ${message}`);
      this.catalog = {};
    }
  }

  getDefaultAiCatalog(): AiProvidersConfig {
    return structuredClone(this.catalog);
  }

  private async fetchCatalog(filePath: string): Promise<AiProvidersConfig> {
    const driver = this.fileStorageDriverFactory.getCurrentDriver();
    const stream = await driver.readFile({ filePath });
    const body = (await streamToBuffer(stream)).toString('utf-8');

    return aiProvidersConfigSchema.parse(JSON.parse(body));
  }
}
