import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { ElectroluxApi } from './electroluxApi.js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class ElectroluxDehumidifierPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  
  // Electrolux API client
  public readonly electroluxApi!: ElectroluxApi;
  
  // Polling interval timer
  private pollingInterval?: NodeJS.Timeout;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // Validate configuration
    if (!config.apiKey) {
      this.log.error('API Key is required in config');
      return;
    }
    
    if (!config.refreshToken) {
      this.log.error('Refresh Token is required in config');
      return;
    }
    
    if (!config.applianceId) {
      this.log.error('Appliance ID is required in config');
      return;
    }
    
    // Create Electrolux API client
    this.electroluxApi = new ElectroluxApi({
      apiKey: config.apiKey as string,
      refreshToken: config.refreshToken as string,
      applianceId: config.applianceId as string,
      debug: config.debug as boolean,
      storagePath: api.user.storagePath(),
    }, this.log);

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
      
      // Start polling for updates
      this.startPolling();
    });
    
    // When homebridge is shutting down
    this.api.on('shutdown', () => {
      this.log.debug('Shutdown');
      // Clear polling interval
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Start polling for device state updates
   */
  startPolling() {
    const pollingIntervalSeconds = this.config.pollingInterval as number || 30;
    this.log.debug(`Starting polling with interval: ${pollingIntervalSeconds} seconds`);
    
    // Clear any existing interval
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }
    
    // Set up polling interval
    this.pollingInterval = setInterval(async () => {
      try {
        this.log.debug('Polling for device state');
        const state = await this.electroluxApi.getApplianceState();
        
        // Update all accessories with the new state
        for (const [, accessory] of this.accessories) {
          accessory.context.state = state;
          
          // Trigger an update event that the accessory can listen for
          this.api.updatePlatformAccessories([accessory]);
        }
      } catch (error) {
        this.log.error('Error polling device state:', error);
      }
    }, pollingIntervalSeconds * 1000);
    
    // Do an initial poll immediately
    this.electroluxApi.getApplianceState()
      .then(state => {
        for (const [, accessory] of this.accessories) {
          accessory.context.state = state;
          this.api.updatePlatformAccessories([accessory]);
        }
      })
      .catch(error => {
        this.log.error('Error during initial state poll:', error);
      });
  }

  /**
   * Register the dehumidifier device
   */
  discoverDevices() {
    // We only have one device - the dehumidifier
    const deviceInfo = {
      uniqueId: this.config.applianceId as string,
      displayName: this.config.name as string || 'Electrolux Dehumidifier',
    };
    
    // Generate a unique id for the accessory
    const uuid = this.api.hap.uuid.generate(deviceInfo.uniqueId);
    
    // See if an accessory with the same uuid has already been registered and restored from cache
    const existingAccessory = this.accessories.get(uuid);
    
    if (existingAccessory) {
      // The accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      
      // Update the accessory context
      existingAccessory.context.device = deviceInfo;
      this.api.updatePlatformAccessories([existingAccessory]);
      
      // Import the platformAccessory.ts module dynamically to avoid circular dependencies
      import('./platformAccessory.js').then(({ ElectroluxDehumidifierAccessory }) => {
        // Create the accessory handler for the restored accessory
        new ElectroluxDehumidifierAccessory(this, existingAccessory);
      }).catch(error => {
        this.log.error('Failed to import platformAccessory module:', error);
      });
    } else {
      // The accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', deviceInfo.displayName);
      
      // Create a new accessory
      const accessory = new this.api.platformAccessory(deviceInfo.displayName, uuid);
      
      // Store a copy of the device info in the `accessory.context`
      accessory.context.device = deviceInfo;
      
      // Import the platformAccessory.ts module dynamically to avoid circular dependencies
      import('./platformAccessory.js').then(({ ElectroluxDehumidifierAccessory }) => {
        // Create the accessory handler
        new ElectroluxDehumidifierAccessory(this, accessory);
        
        // Register the accessory
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }).catch(error => {
        this.log.error('Failed to import platformAccessory module:', error);
      });
    }
    
    // Push into discoveredCacheUUIDs
    this.discoveredCacheUUIDs.push(uuid);
    
    // Remove any cached accessories that are no longer present
    for (const [cachedUuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(cachedUuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
