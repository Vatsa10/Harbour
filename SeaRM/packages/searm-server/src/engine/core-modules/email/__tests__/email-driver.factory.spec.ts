import { Test, type TestingModule } from '@nestjs/testing';

import { EmailDriverFactory } from 'src/engine/core-modules/email/email-driver.factory';
import { EmailDriver } from 'src/engine/core-modules/email/enums/email-driver.enum';
import { ConfigGroupHashService } from 'src/engine/core-modules/searm-config/services/config-group-hash.service';
import { SearmConfigService } from 'src/engine/core-modules/searm-config/searm-config.service';

describe('EmailDriverFactory', () => {
  let factory: EmailDriverFactory;
  let searmConfigService: SearmConfigService;
  let configGroupHashService: ConfigGroupHashService;

  const mockSearmConfigService = {
    get: jest.fn(),
  };
  const mockConfigGroupHashService = {
    computeHash: jest.fn().mockReturnValue(''),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailDriverFactory,
        {
          provide: SearmConfigService,
          useValue: mockSearmConfigService,
        },
        {
          provide: ConfigGroupHashService,
          useValue: mockConfigGroupHashService,
        },
      ],
    }).compile();

    factory = module.get<EmailDriverFactory>(EmailDriverFactory);
    searmConfigService = module.get<SearmConfigService>(SearmConfigService);
    configGroupHashService = module.get<ConfigGroupHashService>(
      ConfigGroupHashService,
    );

    jest.clearAllMocks();
  });

  describe('buildConfigKey', () => {
    it('should return "logger" for logger driver', () => {
      jest
        .spyOn(searmConfigService, 'get')
        .mockReturnValue(EmailDriver.LOGGER);

      const result = factory['buildConfigKey']();

      expect(result).toBe('logger');
      expect(searmConfigService.get).toHaveBeenCalledWith('EMAIL_DRIVER');
    });

    it('should return smtp config key for smtp driver', () => {
      jest.spyOn(searmConfigService, 'get').mockReturnValue(EmailDriver.SMTP);
      jest
        .spyOn(configGroupHashService, 'computeHash')
        .mockReturnValue('smtp-hash-123');

      const result = factory['buildConfigKey']();

      expect(result).toBe('smtp|smtp-hash-123');
      expect(searmConfigService.get).toHaveBeenCalledWith('EMAIL_DRIVER');
    });

    it('should throw error for unsupported driver', () => {
      jest.spyOn(searmConfigService, 'get').mockReturnValue('invalid-driver');

      expect(() => factory['buildConfigKey']()).toThrow(
        'Unsupported email driver: invalid-driver',
      );
    });
  });

  describe('createDriver', () => {
    it('should create logger driver', () => {
      jest
        .spyOn(searmConfigService, 'get')
        .mockReturnValue(EmailDriver.LOGGER);

      const driver = factory['createDriver']();

      expect(driver).toBeDefined();
      expect(driver.constructor.name).toBe('LoggerDriver');
    });

    it('should create smtp driver with basic configuration', () => {
      jest
        .spyOn(searmConfigService, 'get')
        .mockImplementation((key: string) => {
          switch (key) {
            case 'EMAIL_DRIVER':
              return EmailDriver.SMTP;
            case 'EMAIL_SMTP_HOST':
              return 'smtp.example.com';
            case 'EMAIL_SMTP_PORT':
              return 587;
            case 'EMAIL_SMTP_USER':
              return undefined;
            case 'EMAIL_SMTP_PASSWORD':
              return undefined;
            case 'EMAIL_SMTP_NO_TLS':
              return false;
            default:
              return undefined;
          }
        });

      const driver = factory['createDriver']();

      expect(driver).toBeDefined();
      expect(driver.constructor.name).toBe('SmtpDriver');
    });

    it('should throw error when smtp host is missing', () => {
      jest
        .spyOn(searmConfigService, 'get')
        .mockImplementation((key: string) => {
          switch (key) {
            case 'EMAIL_DRIVER':
              return EmailDriver.SMTP;
            case 'EMAIL_SMTP_HOST':
              return undefined;
            case 'EMAIL_SMTP_PORT':
              return 587;
            default:
              return undefined;
          }
        });

      expect(() => factory['createDriver']()).toThrow(
        'SMTP driver requires host and port to be defined',
      );
    });

    it('should throw error for invalid driver', () => {
      jest.spyOn(searmConfigService, 'get').mockReturnValue('invalid-driver');

      expect(() => factory['createDriver']()).toThrow(
        'Invalid email driver: invalid-driver',
      );
    });
  });

  describe('getCurrentDriver', () => {
    it('should return current driver for logger', () => {
      jest
        .spyOn(searmConfigService, 'get')
        .mockReturnValue(EmailDriver.LOGGER);

      const driver = factory.getCurrentDriver();

      expect(driver).toBeDefined();
      expect(driver.constructor.name).toBe('LoggerDriver');
    });

    it('should reuse driver when config key unchanged', () => {
      jest
        .spyOn(searmConfigService, 'get')
        .mockReturnValue(EmailDriver.LOGGER);

      const driver1 = factory.getCurrentDriver();
      const driver2 = factory.getCurrentDriver();

      expect(driver1).toBe(driver2);
    });

    it('should create new driver when config key changes', () => {
      // First call with logger
      jest
        .spyOn(searmConfigService, 'get')
        .mockReturnValue(EmailDriver.LOGGER);

      const driver1 = factory.getCurrentDriver();

      // Second call with smtp
      jest
        .spyOn(searmConfigService, 'get')
        .mockImplementation((key: string) => {
          switch (key) {
            case 'EMAIL_DRIVER':
              return EmailDriver.SMTP;
            case 'EMAIL_SMTP_HOST':
              return 'smtp.example.com';
            case 'EMAIL_SMTP_PORT':
              return 587;
            default:
              return undefined;
          }
        });
      jest
        .spyOn(configGroupHashService, 'computeHash')
        .mockReturnValue('smtp-hash-123');

      const driver2 = factory.getCurrentDriver();

      expect(driver1).not.toBe(driver2);
      expect(driver1.constructor.name).toBe('LoggerDriver');
      expect(driver2.constructor.name).toBe('SmtpDriver');
    });

    it('should throw error for unsupported email driver', () => {
      jest.spyOn(searmConfigService, 'get').mockReturnValue('invalid-driver');

      expect(() => factory.getCurrentDriver()).toThrow(
        'Failed to build config key for EmailDriverFactory. Original error: Unsupported email driver: invalid-driver',
      );
    });

    it('should throw error when driver creation fails after valid config', () => {
      jest
        .spyOn(searmConfigService, 'get')
        .mockImplementation((key: string) => {
          switch (key) {
            case 'EMAIL_DRIVER':
              return EmailDriver.SMTP;
            case 'EMAIL_SMTP_HOST':
              return 'smtp.example.com';
            case 'EMAIL_SMTP_PORT':
              return 587;
            default:
              return undefined;
          }
        });

      jest
        .spyOn(configGroupHashService, 'computeHash')
        .mockReturnValue('smtp-hash-123');

      jest.spyOn(factory as any, 'createDriver').mockImplementation(() => {
        throw new Error('Driver creation failed');
      });

      expect(() => factory.getCurrentDriver()).toThrow(
        'Failed to create driver for EmailDriverFactory with config key: smtp|smtp-hash-123. Original error: Driver creation failed',
      );
    });
  });
});
