
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
    this.log.debug(`startPolling: Starting polling with interval: ${pollingIntervalSeconds} seconds`);
    
    // Clear any existing interval
    if (this.pollingInterval) {
      this.log.debug('startPolling: Clearing existing polling interval');
      clearInterval(this.pollingInterval);
    }
    
    if (this.config.debug) {
      this.log.debug(
        'startPolling: Using pollingInterval from config: ' +
        `${this.config.pollingInterval !== undefined ? this.config.pollingInterval : 'not set, using default'}`,
      );
      this.log.debug(`startPolling: Debug mode is enabled: ${this.config.debug}`);
    }
    
    // Set up polling interval
    this.log.debug('startPolling: Setting up polling interval');
    this.pollingInterval = setInterval(async () => {
      try {
        this.log.debug('startPolling: Polling for device state');
        const state = await this.electroluxApi.getApplianceState();
        
        // Check water bucket level and log warning if it's high
        if (state.waterBucketLevel > 90) {
          this.log.warn(`Water bucket level is high (${state.waterBucketLevel}%) - please empty soon!`);
        }
        
        // Only log detailed state information when debug mode is enabled
        if (this.config.debug) {
          this.log.debug('startPolling: Received state from API:');
          this.log.debug(JSON.stringify(state, null, 2));
          this.log.debug(
            `startPolling: Polled state: applianceState="${state.applianceState}", ` +
            `mode=${state.mode}, cleanAirMode=${state.cleanAirMode}, humidity=${state.sensorHumidity}%`,
          );
        }
        
        // We no longer need to update the accessory context with the state
        // since we're always fetching the latest state from the API in platformAccessory.ts
        // This is kept for logging purposes only
        const accessoryCount = this.accessories.size;
        if (this.config.debug) {
          this.log.debug(`startPolling: Polled state for ${accessoryCount} accessories`);
          this.log.debug(
            `startPolling: State: applianceState="${state.applianceState}", ` +
            `mode=${state.mode}, cleanAirMode=${state.cleanAirMode}, humidity=${state.sensorHumidity}%`,
          );
        }
        
        if (this.config.debug) {
          this.log.debug('startPolling: All accessories updated successfully');
        }
      } catch (error) {
        this.log.error('startPolling: Error polling device state:', error);
      }
    }, pollingIntervalSeconds * 1000);
    
    // Do an initial poll immediately
    this.log.debug('startPolling: Performing initial poll immediately');
    this.electroluxApi.getApplianceState()
      .then(state => {
        if (this.config.debug) {
          this.log.debug('startPolling: Initial poll successful');
          this.log.debug(
            `startPolling: Initial state: applianceState="${state.applianceState}", ` +
            `mode=${state.mode}, cleanAirMode=${state.cleanAirMode}, humidity=${state.sensorHumidity}%`,
          );
        }
        
        // Check water bucket level and log warning if it's high
        if (state.waterBucketLevel > 90) {
          this.log.warn(`Water bucket level is high (${state.waterBucketLevel}%) - please empty soon!`);
        }
        
        // We no longer need to update the accessory context with the state
        // since we're always fetching the latest state from the API in platformAccessory.ts
        if (this.config.debug) {
          this.log.debug(
            `startPolling: Initial state: applianceState="${state.applianceState}", ` +
            `mode=${state.mode}, cleanAirMode=${state.cleanAirMode}, humidity=${state.sensorHumidity}%`,
          );
        }
        
        if (this.config.debug) {
          this.log.debug('startPolling: Initial state update complete');
        }
      })
      .catch(error => {
        this.log.error('startPolling: Error during initial state poll:', error);
      });
  }

  /**
   * Register the dehumidifier device
   */
  discoverDevices() {
    if (this.config.debug) {
      this.log.debug('discoverDevices: Starting device discovery');
      this.log.debug(`discoverDevices: Using applianceId from config: ${this.config.applianceId}`);
      this.log.debug(`discoverDevices: Using name from config: ${this.config.name || 'not set, using default'}`);
    }
    
    // We only have one device - the dehumidifier
    const deviceInfo = {
      uniqueId: this.config.applianceId as string,
      displayName: this.config.name as string || 'Electrolux Dehumidifier',
    };
    
    // Generate a unique id for the accessory
    const uuid = this.api.hap.uuid.generate(deviceInfo.uniqueId);
    
    if (this.config.debug) {
      this.log.debug(`discoverDevices: Generated UUID for device: ${uuid}`);
      this.log.debug(`discoverDevices: Device info: ${JSON.stringify(deviceInfo)}`);
    }
    
    // See if an accessory with the same uuid has already been registered and restored from cache
    const existingAccessory = this.accessories.get(uuid);
    
    if (existingAccessory) {
      // The accessory already exists
      this.log.info('discoverDevices: Restoring existing accessory from cache:', existingAccessory.displayName);
      
      if (this.config.debug) {
        this.log.debug(`discoverDevices: Existing accessory found with UUID: ${uuid}`);
        this.log.debug('discoverDevices: Updating accessory context with device info');
      }
      
      // Update the accessory context
      existingAccessory.context.device = deviceInfo;
      this.api.updatePlatformAccessories([existingAccessory]);
      
      if (this.config.debug) {
        this.log.debug('discoverDevices: Importing platformAccessory module');
      }
      
      // Import the platformAccessory.ts module dynamically to avoid circular dependencies
      import('./platformAccessory.js').then(({ ElectroluxDehumidifierAccessory }) => {
        if (this.config.debug) {
          this.log.debug('discoverDevices: Creating accessory handler for restored accessory');
        }
        
        // Create the accessory handler for the restored accessory
        new ElectroluxDehumidifierAccessory(this, existingAccessory);
        
        if (this.config.debug) {
          this.log.debug('discoverDevices: Accessory handler created successfully');
        }
      }).catch(error => {
        this.log.error('discoverDevices: Failed to import platformAccessory module:', error);
      });
    } else {
      // The accessory does not yet exist, so we need to create it
      this.log.info('discoverDevices: Adding new accessory:', deviceInfo.displayName);
      
      if (this.config.debug) {
        this.log.debug(`discoverDevices: No existing accessory found with UUID: ${uuid}`);
        this.log.debug('discoverDevices: Creating new accessory');
      }
      
      // Create a new accessory
      const accessory = new this.api.platformAccessory(deviceInfo.displayName, uuid);
      
      if (this.config.debug) {
        this.log.debug('discoverDevices: Storing device info in accessory context');
      }
      
      // Store a copy of the device info in the `accessory.context`
      accessory.context.device = deviceInfo;
      
      if (this.config.debug) {
        this.log.debug('discoverDevices: Importing platformAccessory module');
      }
      
      // Import the platformAccessory.ts module dynamically to avoid circular dependencies
      import('./platformAccessory.js').then(({ ElectroluxDehumidifierAccessory }) => {
        if (this.config.debug) {
          this.log.debug('discoverDevices: Creating accessory handler for new accessory');
        }
        
        // Create the accessory handler
        new ElectroluxDehumidifierAccessory(this, accessory);
        
        if (this.config.debug) {
          this.log.debug(`discoverDevices: Registering new accessory with Homebridge: ${deviceInfo.displayName}`);
        }
        
        // Register the accessory
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        
        if (this.config.debug) {
          this.log.debug('discoverDevices: Accessory registered successfully');
        }
      }).catch(error => {
        this.log.error('discoverDevices: Failed to import platformAccessory module:', error);
      });
    }
    
    // Push into discoveredCacheUUIDs
    this.discoveredCacheUUIDs.push(uuid);
    
    if (this.config.debug) {
      this.log.debug(`discoverDevices: Added UUID to discoveredCacheUUIDs: ${uuid}`);
      this.log.debug(`discoverDevices: Total discovered UUIDs: ${this.discoveredCacheUUIDs.length}`);
      this.log.debug('discoverDevices: Checking for cached accessories to remove');
    }
    
    // Remove any cached accessories that are no longer present
    for (const [cachedUuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(cachedUuid)) {
        this.log.info('discoverDevices: Removing existing accessory from cache:', accessory.displayName);
        
        if (this.config.debug) {
          this.log.debug(`discoverDevices: Removing accessory with UUID: ${cachedUuid}`);
        }
        
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        
        if (this.config.debug) {
          this.log.debug('discoverDevices: Accessory removed successfully');
        }
      }
    }
    
    if (this.config.debug) {
      this.log.debug('discoverDevices: Device discovery completed');
    }
  }
}
