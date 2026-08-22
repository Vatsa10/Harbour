import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { AuthSsoService } from 'src/engine/core-modules/auth/services/auth-sso.service';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';

describe('AuthSsoService', () => {
  let authSsoService: AuthSsoService;
  let workspaceRepository: Repository<WorkspaceEntity>;
  let searmConfigService: SearmConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSsoService,
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: SearmConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    authSsoService = module.get<AuthSsoService>(AuthSsoService);
    workspaceRepository = module.get<Repository<WorkspaceEntity>>(
      getRepositoryToken(WorkspaceEntity),
    );
    searmConfigService = module.get<SearmConfigService>(SearmConfigService);
  });

  describe('findWorkspaceFromWorkspaceIdOrAuthProvider', () => {
    it('should return a workspace by workspaceId', async () => {
      const workspaceId = 'workspace-id-123';
      const mockWorkspace = { id: workspaceId } as WorkspaceEntity;

      jest
        .spyOn(workspaceRepository, 'findOne')
        .mockResolvedValue(mockWorkspace);

      const result =
        await authSsoService.findWorkspaceFromWorkspaceIdOrAuthProvider(
          { authProvider: AuthProviderEnum.Google, email: 'test@example.com' },
          workspaceId,
        );

      expect(result).toEqual(mockWorkspace);
      expect(workspaceRepository.findOne).toHaveBeenCalledWith({
        where: {
          id: workspaceId,
        },
        relations: ['approvedAccessDomains'],
      });
    });

    it('should return a workspace from authProvider and email when multi-workspace mode is enabled', async () => {
      const authProvider = AuthProviderEnum.Google;
      const email = 'test@example.com';
      const mockWorkspace = { id: 'workspace-id-456' } as WorkspaceEntity;

      jest.spyOn(searmConfigService, 'get').mockReturnValue(true);
      jest
        .spyOn(workspaceRepository, 'findOne')
        .mockResolvedValue(mockWorkspace);

      const result =
        await authSsoService.findWorkspaceFromWorkspaceIdOrAuthProvider({
          authProvider,
          email,
        });

      expect(result).toEqual(mockWorkspace);
      expect(workspaceRepository.findOne).toHaveBeenCalledWith({
        where: {
          isGoogleAuthEnabled: true,
          workspaceUsers: {
            user: {
              email,
            },
          },
        },
        relations: [
          'workspaceUsers',
          'workspaceUsers.user',
          'approvedAccessDomains',
        ],
      });
    });

    it('should return undefined if no workspace is found when multi-workspace mode is enabled', async () => {
      jest.spyOn(searmConfigService, 'get').mockReturnValue(true);
      jest.spyOn(workspaceRepository, 'findOne').mockResolvedValue(null);

      const result =
        await authSsoService.findWorkspaceFromWorkspaceIdOrAuthProvider({
          authProvider: AuthProviderEnum.Google,
          email: 'notfound@example.com',
        });

      expect(result).toBeUndefined();
    });

    it('should throw an error for an invalid authProvider', async () => {
      jest.spyOn(searmConfigService, 'get').mockReturnValue(true);

      await expect(
        authSsoService.findWorkspaceFromWorkspaceIdOrAuthProvider({
          authProvider: 'invalid-provider' as any,
          email: 'test@example.com',
        }),
      ).rejects.toThrow('invalid-provider is not a valid auth provider.');
    });
  });
});
