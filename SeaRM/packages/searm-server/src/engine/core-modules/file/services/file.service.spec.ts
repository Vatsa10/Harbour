import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { FileStorageService } from 'src/engine/core-modules/file-storage/services/file-storage.service';
import { FileEntity } from 'src/engine/core-modules/file/entities/file.entity';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/searm-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';
import { FileService } from './file.service';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mocked-uuid'),
}));

describe('FileService', () => {
  let service: FileService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileService,
        {
          provide: SearmConfigService,
          useValue: {},
        },
        {
          provide: JwtWrapperService,
          useValue: {},
        },
        {
          provide: FileStorageService,
          useValue: {},
        },
        {
          provide: getWorkspaceScopedRepositoryToken(FileEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(ApplicationEntity),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<FileService>(FileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
