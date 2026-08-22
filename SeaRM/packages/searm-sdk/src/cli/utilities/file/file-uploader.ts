import { ApiService } from '@/cli/utilities/api/api-service';
import path, { relative } from 'path';
import { type FileFolder } from 'searm-shared/types';
import { OUTPUT_DIR } from 'searm-shared/application';

export class FileUploader {
  private apiService = new ApiService();
  private applicationUniversalIdentifier: string;
  private appPath: string;

  constructor(options: {
    applicationUniversalIdentifier: string;
    appPath: string;
  }) {
    this.applicationUniversalIdentifier =
      options.applicationUniversalIdentifier;
    this.appPath = options.appPath;
  }

  async uploadFile({
    builtPath,
    fileFolder,
  }: {
    builtPath: string;
    fileFolder: FileFolder;
  }) {
    const builtHandlerPath = relative(OUTPUT_DIR, builtPath);

    return await this.apiService.uploadFile({
      filePath: path.join(this.appPath, builtPath),
      builtHandlerPath,
      fileFolder,
      applicationUniversalIdentifier: this.applicationUniversalIdentifier,
    });
  }
}
