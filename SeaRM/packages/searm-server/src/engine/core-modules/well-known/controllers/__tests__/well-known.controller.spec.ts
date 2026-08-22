import { Test, type TestingModule } from '@nestjs/testing';

import { type Request } from 'express';

import { WellKnownController } from 'src/engine/core-modules/well-known/controllers/well-known.controller';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

describe('WellKnownController', () => {
  let controller: WellKnownController;
  const configGet = jest.fn();

  const buildMockRequest = (host: string, protocol = 'https') =>
    ({
      protocol,
      get: (header: string) =>
        header.toLowerCase() === 'host' ? host : undefined,
    }) as unknown as Request;

  beforeEach(async () => {
    configGet.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WellKnownController],
      providers: [
        {
          provide: SearmConfigService,
          useValue: { get: configGet },
        },
      ],
    }).compile();

    controller = module.get(WellKnownController);
  });

  describe('getMcpServerCard', () => {
    it('builds the card for the request host', () => {
      configGet.mockReturnValue('1.2.3');

      const card = controller.getMcpServerCard(
        buildMockRequest('workspace.searm.com'),
      );

      expect(card.remotes[0].url).toBe('https://workspace.searm.com/mcp');
      expect(card.version).toBe('1.2.3');
    });

    it('falls back to 0.0.0 when APP_VERSION is unset', () => {
      configGet.mockReturnValue(undefined);

      const card = controller.getMcpServerCard(
        buildMockRequest('workspace.searm.com'),
      );

      expect(card.version).toBe('0.0.0');
    });
  });

  describe('getApiCatalog', () => {
    it('returns a parseable linkset anchored on the request host', () => {
      const body = controller.getApiCatalog(
        buildMockRequest('workspace.searm.com'),
      );

      const parsed = JSON.parse(body);

      expect(
        parsed.linkset.map((entry: { anchor: string }) => entry.anchor),
      ).toContain('https://workspace.searm.com/rest');
    });

    it('respects the forwarded protocol', () => {
      const body = controller.getApiCatalog(
        buildMockRequest('localhost:3000', 'http'),
      );

      expect(JSON.parse(body).linkset[0].anchor).toBe(
        'http://localhost:3000/rest',
      );
    });
  });
});
