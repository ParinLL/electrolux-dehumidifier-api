import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { ElectroluxApi } from './electroluxApi.js';

export class ElectroluxDehumidifierPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  public readonly electroluxApi!: ElectroluxApi;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    if (!config.apiKey || !config.refreshToken || !config.applianceId) {
      this.log.error('apiKey, refreshToken, and applianceId are all required in config');
      return;
    }

    this.electroluxApi = new ElectroluxApi({
      apiKey: config.apiKey as string,
      refreshToken: config.refreshToken as string,
      applianceId: config.applianceId as string,
      debug: config.debug as boolean,
      storagePath: api.user.storagePath(),
    }, this.log);

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  discoverDevices() {
    const deviceInfo = {
      uniqueId: this.config.applianceId as string,
      displayName: this.config.name as string || 'Electrolux Dehumidifier',
    };

    const uuid = this.api.hap.uuid.generate(deviceInfo.uniqueId);
    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      existingAccessory.context.device = deviceInfo;
      this.api.updatePlatformAccessories([existingAccessory]);

      import('./platformAccessory.js').then(({ ElectroluxDehumidifierAccessory }) => {
        new ElectroluxDehumidifierAccessory(this, existingAccessory);
      });
    } else {
      this.log.info('Adding new accessory:', deviceInfo.displayName);
      const accessory = new this.api.platformAccessory(deviceInfo.displayName, uuid);
      accessory.context.device = deviceInfo;

      import('./platformAccessory.js').then(({ ElectroluxDehumidifierAccessory }) => {
        new ElectroluxDehumidifierAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      });
    }

    this.discoveredCacheUUIDs.push(uuid);

    // Remove stale cached accessories
    for (const [cachedUuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(cachedUuid)) {
        this.log.info('Removing stale accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
