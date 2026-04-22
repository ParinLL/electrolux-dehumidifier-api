import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ElectroluxDehumidifierPlatform } from './platform.js';
import { ApplianceState } from './electroluxApi.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ElectroluxDehumidifierAccessory {
  // Services
  private switchService: Service;
  private humiditySensorService: Service;
  private fanService: Service;
  private autoModeService: Service;
  private dryModeService: Service;
  private quietModeService: Service;
  
  // Keep track of the current state
  private currentState: ApplianceState | null = null;
  private shutdownTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor(
    private readonly platform: ElectroluxDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Electrolux')
      .setCharacteristic(this.platform.Characteristic.Model, 'Dehumidifier')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.uniqueId);

    // Remove any existing services except for the AccessoryInformation service
    const services = this.accessory.services.slice();
    for (const service of services) {
      if (service.UUID !== this.platform.Service.AccessoryInformation.UUID) {
        this.accessory.removeService(service);
      }
    }

    // Create a simple switch service for on/off functionality
    this.switchService = this.accessory.getService(this.platform.Service.Switch) || 
      this.accessory.addService(this.platform.Service.Switch);
    
    // Set the service name
    this.switchService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);
    
    // Configure the switch service with on/off functionality
    this.switchService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
      
    // Create a humidity sensor service
    this.humiditySensorService = this.accessory.getService(this.platform.Service.HumiditySensor) ||
      this.accessory.addService(this.platform.Service.HumiditySensor, 'Humidity Sensor', 'humidity');
      
    // Set the service name
    this.humiditySensorService.setCharacteristic(this.platform.Characteristic.Name, 'Humidity');
    
    // Configure the humidity sensor service
    this.humiditySensorService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentHumidity.bind(this));

    // Create a Facev2 service for Fan speed control
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || 
      this.accessory.addService(this.platform.Service.Fanv2, 'Fan');
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, 'Fan Speed');
    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getFanActive.bind(this))
      .onSet(this.setFanActive.bind(this));
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.getFanSpeed.bind(this))
      .onSet(this.setFanSpeed.bind(this));

    // Create Switch services for Mode control
    this.autoModeService = this.accessory.getServiceById(this.platform.Service.Switch, 'AutoMode') || 
      this.accessory.addService(this.platform.Service.Switch, 'Auto Mode', 'AutoMode');
    this.autoModeService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.getModeState('AUTO'))
      .onSet((val) => this.setModeState('AUTO', val));

    this.dryModeService = this.accessory.getServiceById(this.platform.Service.Switch, 'DryMode') || 
      this.accessory.addService(this.platform.Service.Switch, 'Dry Mode', 'DryMode');
    this.dryModeService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.getModeState('DRY'))
      .onSet((val) => this.setModeState('DRY', val));

    this.quietModeService = this.accessory.getServiceById(this.platform.Service.Switch, 'QuietMode') || 
      this.accessory.addService(this.platform.Service.Switch, 'Quiet Mode', 'QuietMode');
    this.quietModeService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.getModeState('QUIET'))
      .onSet((val) => this.setModeState('QUIET', val));
    
    // Set up a method to handle state updates
    this.setupStateUpdateHandler();
    
    // We'll fetch the state from the API when needed instead of using cached state
    // This ensures we always have the latest state
  }
  
  /**
   * Update all characteristics based on the current state
   */
  private updateAllCharacteristics() {
    if (!this.currentState) {
      this.platform.log.debug('updateAllCharacteristics: No current state available');
      return;
    }
    
    // Log the complete state object when debug is enabled
    if (this.platform.config.debug) {
      this.platform.log.debug('updateAllCharacteristics: Current state object:');
      this.platform.log.debug(JSON.stringify(this.currentState, null, 2));
    }
    
    // Determine if the device is ON or OFF based on multiple factors
    const isOn = this.determineDeviceOnState(this.currentState);
    
    // Only log detailed state information when debug mode is enabled
    if (this.platform.config.debug) {
      this.platform.log.debug(
        `updateAllCharacteristics: Final state: applianceState="${this.currentState.applianceState}", cleanAirMode="${this.currentState.cleanAirMode}", ` +
        `mode="${this.currentState.mode}", mapped to: ${isOn ? 'ON' : 'OFF'}, humidity: ${this.currentState.sensorHumidity}%`,
      );
    }
    
    // Update switch service
    this.platform.log.debug(`Setting switch characteristic to: ${isOn}`);
    this.switchService.updateCharacteristic(
      this.platform.Characteristic.On,
      isOn,
    );
    
    // Update humidity sensor service
    this.humiditySensorService.updateCharacteristic(
      this.platform.Characteristic.CurrentRelativeHumidity,
      this.currentState.sensorHumidity,
    );
    
    // Update fan service
    this.fanService.updateCharacteristic(
      this.platform.Characteristic.Active,
      isOn ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE,
    );
    
    const speed = this.currentState.fanSpeedSetting;
    let rotationSpeed = 0;
    if (speed === 'HIGH') rotationSpeed = 100;
    else if (speed === 'MIDDLE') rotationSpeed = 50;
    else if (speed === 'LOW') rotationSpeed = 25;
    this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, rotationSpeed);

    // Update mode switches
    this.autoModeService.updateCharacteristic(this.platform.Characteristic.On, this.currentState.mode === 'AUTO');
    this.dryModeService.updateCharacteristic(this.platform.Characteristic.On, this.currentState.mode === 'DRY');
    this.quietModeService.updateCharacteristic(this.platform.Characteristic.On, this.currentState.mode === 'QUIET');
  }
  
  /**
   * Determine if the device is ON or OFF based on the current state
   * This is a centralized function to ensure consistent ON/OFF determination
   * across all methods
   */
  private determineDeviceOnState(state: ApplianceState): boolean {
    // Log detailed information about the state when debug is enabled
    if (this.platform.config.debug) {
      this.platform.log.debug(
        `determineDeviceOnState: Analyzing state - applianceState="${state.applianceState}", ` +
        `cleanAirMode="${state.cleanAirMode}", mode="${state.mode}"`,
      );
    }
    
    // CASE 1: If applianceState is 'RUNNING', the device is definitely ON
    if (state.applianceState === 'RUNNING') {
      if (this.platform.config.debug) {
        this.platform.log.debug('determineDeviceOnState: applianceState is RUNNING => Device is ON');
      }
      return true;
    }
    
    // CASE 2: If applianceState is 'OFF', the device is definitely OFF
    if (state.applianceState === 'OFF') {
      if (this.platform.config.debug) {
        this.platform.log.debug('determineDeviceOnState: applianceState is OFF => Device is OFF');
      }
      return false;
    }
    
    // CASE 3: For other applianceState values, we need to check additional factors
    
    // Check if cleanAirMode is ON
    const isCleanAirModeOn = state.cleanAirMode === 'ON';
    if (this.platform.config.debug) {
      this.platform.log.debug(`determineDeviceOnState: cleanAirMode="${state.cleanAirMode}" => isCleanAirModeOn=${isCleanAirModeOn}`);
    }
    
    // Check if a mode is set (not empty)
    const hasModeSet = state.mode && state.mode !== '';
    if (this.platform.config.debug) {
      this.platform.log.debug(`determineDeviceOnState: mode="${state.mode}" => hasModeSet=${hasModeSet}`);
    }
    
    // Check if fan speed is set to something other than OFF
    const hasFanSpeed = state.fanSpeedSetting && state.fanSpeedSetting !== '' && state.fanSpeedSetting !== 'OFF';
    if (this.platform.config.debug) {
      this.platform.log.debug(`determineDeviceOnState: fanSpeedSetting="${state.fanSpeedSetting}" => hasFanSpeed=${hasFanSpeed}`);
    }
    
    // If cleanAirMode is ON and a mode is set, consider the device to be ON
    if (isCleanAirModeOn && hasModeSet) {
      if (this.platform.config.debug) {
        this.platform.log.debug('determineDeviceOnState: cleanAirMode is ON and mode is set => Device is ON');
      }
      return true;
    }
    
    // If a mode is set and fan speed is active, consider the device to be ON
    if (hasModeSet && hasFanSpeed) {
      if (this.platform.config.debug) {
        this.platform.log.debug('determineDeviceOnState: Mode is set and fan speed is active => Device is ON');
      }
      return true;
    }
    
    // Default case: If none of the above conditions are met, consider the device to be OFF
    if (this.platform.config.debug) {
      this.platform.log.debug('determineDeviceOnState: No ON conditions met => Device is OFF');
    }
    return false;
  }
  
  /**
   * Handle "GET" requests for the CurrentRelativeHumidity characteristic
   */
  async getCurrentHumidity(): Promise<CharacteristicValue> {
    try {
      this.platform.log.debug('getCurrentHumidity: Fetching current state from API');
      this.currentState = await this.platform.electroluxApi.getApplianceState();
      
      // Log the complete state object when debug is enabled
      if (this.platform.config.debug) {
        this.platform.log.debug('getCurrentHumidity: Fetched state object:');
        this.platform.log.debug(JSON.stringify(this.currentState, null, 2));
      }
    } catch (error) {
      this.platform.log.error('Failed to get humidity:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    
    const humidity = this.currentState.sensorHumidity;
    
    if (this.platform.config.debug) {
      this.platform.log.debug(`getCurrentHumidity: Current humidity value is ${humidity}%`);
    }
    
    return humidity;
  }
  
  
  /**
   * Set up a handler for state updates
   * This is called when the platform updates the accessory context with new state
   */
  private setupStateUpdateHandler() {
    // Monitor for changes to the accessory context
    this.platform.api.on('didFinishLaunching', () => {
      // We don't need to check for state updates periodically here anymore
      // since we're always fetching the latest state from the API in getOn and getCurrentHumidity
      // This handler is kept for backward compatibility
    });
  }

  /**
   * Handle "SET" requests for the On characteristic
   */
  async setOn(value: CharacteristicValue) {
    this.platform.log.debug(`setOn: Setting device to ${value ? 'ON' : 'OFF'}`);
    
    try {
      if (value) {
        // Cancel any pending shutdown
        if (this.shutdownTimer) {
          clearTimeout(this.shutdownTimer);
          this.shutdownTimer = null;
        }
        this.isShuttingDown = false;

        // Turn on with AUTO mode and clean air mode ON
        if (this.platform.config.debug) {
          this.platform.log.debug('setOn: Turning device ON with AUTO mode and clean air mode ON');
        }
        await this.platform.electroluxApi.turnOn();
        if (this.platform.config.debug) {
          this.platform.log.debug('setOn: Device turned ON successfully');
        }
      } else {
        // Instead of immediate turn off, start a 20-minute cooldown
        if (this.platform.config.debug) {
          this.platform.log.debug('setOn: Starting 20-minute fan cooldown before turning device OFF');
        }
        this.platform.log.info('設備已進入送風冷卻模式，將於 20 分鐘後自動關閉。');
        this.isShuttingDown = true;
        
        // Use QUIET mode for cooldown requested by user
        try {
          await this.platform.electroluxApi.setMode('QUIET');
        } catch (e) {
          this.platform.log.warn('setOn: Failed to set QUIET mode for cooldown', e);
        }

        // Clear any existing timer
        if (this.shutdownTimer) {
          clearTimeout(this.shutdownTimer);
        }

        // Schedule actual turn off after 20 minutes (20 * 60 * 1000 ms)
        this.shutdownTimer = setTimeout(async () => {
          this.platform.log.info('20 分鐘送風結束，正在關閉設備。');
          try {
            await this.platform.electroluxApi.turnOff();
            this.isShuttingDown = false;
            this.shutdownTimer = null;
            if (this.platform.config.debug) {
              this.platform.log.debug('setOn: Device turned OFF successfully after cooldown');
            }
          } catch (error) {
            this.platform.log.error('setOn: Failed to turn OFF device after cooldown:', error);
          }
        }, 20 * 60 * 1000);
      }
    } catch (error) {
      this.platform.log.error(`setOn: Failed to set device to ${value ? 'ON' : 'OFF'}:`, error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle "GET" requests for the On characteristic
   */
  async getOn(): Promise<CharacteristicValue> {
    // Spoof OFF state during cooldown phase
    if (this.isShuttingDown) {
      if (this.platform.config.debug) {
        this.platform.log.debug('getOn: Device is currently in shutdown cooldown phase, returning OFF');
      }
      return false;
    }

    try {
      this.platform.log.debug('getOn: Fetching current state from API');
      this.currentState = await this.platform.electroluxApi.getApplianceState();
      
      // Log the complete state object when debug is enabled
      if (this.platform.config.debug) {
        this.platform.log.debug('getOn: Fetched state object:');
        this.platform.log.debug(JSON.stringify(this.currentState, null, 2));
      }
    } catch (error) {
      this.platform.log.error('Failed to get on state:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    
    // Use the centralized function to determine if the device is ON or OFF
    const isOn = this.determineDeviceOnState(this.currentState);
    
    // Only log detailed state information when debug mode is enabled
    if (this.platform.config.debug) {
      this.platform.log.debug(
        `getOn: Final decision: applianceState="${this.currentState.applianceState}", cleanAirMode="${this.currentState.cleanAirMode}", ` +
        `mode="${this.currentState.mode}", mapped to: ${isOn ? 'ON' : 'OFF'}`,
      );
    }
    
    return isOn;
  }

  /**
   * Helper to fetch latest state
   */
  async getCurrentStateFromApi() {
    try {
      this.platform.log.debug('Fetching current state from API globally');
      this.currentState = await this.platform.electroluxApi.getApplianceState();
    } catch (error) {
      this.platform.log.error('Failed to get state:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Fan Mode & Speed Handlers
   */
  async getFanActive(): Promise<CharacteristicValue> {
    const isOn = await this.getOn();
    return isOn ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE;
  }

  async setFanActive(value: CharacteristicValue) {
    const isPoweringOn = value === this.platform.Characteristic.Active.ACTIVE;
    await this.setOn(isPoweringOn);
  }

  async getFanSpeed(): Promise<CharacteristicValue> {
    if (!this.currentState) await this.getCurrentStateFromApi();
    const speed = this.currentState?.fanSpeedSetting;
    if (speed === 'HIGH') return 100;
    if (speed === 'MIDDLE') return 50;
    if (speed === 'LOW') return 25;
    return 0;
  }

  async setFanSpeed(value: CharacteristicValue) {
    const numValue = value as number;
    let targetSpeed: 'HIGH' | 'MIDDLE' | 'LOW' = 'LOW';
    if (numValue > 66) targetSpeed = 'HIGH';
    else if (numValue > 33) targetSpeed = 'MIDDLE';
    
    this.platform.log.debug(`Setting fan speed to ${targetSpeed} (${numValue}%)`);
    try {
      await this.platform.electroluxApi.setFanSpeed(targetSpeed);
    } catch (error) {
      this.platform.log.error('Failed to set fan speed:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Mode Control Handlers
   */
  async getModeState(mode: 'AUTO' | 'DRY' | 'QUIET'): Promise<CharacteristicValue> {
    if (!this.currentState) await this.getCurrentStateFromApi();
    return this.currentState?.mode === mode;
  }

  async setModeState(mode: 'AUTO' | 'DRY' | 'QUIET', value: CharacteristicValue) {
    if (value) {
      this.platform.log.debug(`Setting mode to ${mode}`);
      try {
        await this.platform.electroluxApi.setMode(mode);
        
        // Ensure other switches appear off in the Home app
        if (mode !== 'AUTO') this.autoModeService.updateCharacteristic(this.platform.Characteristic.On, false);
        if (mode !== 'DRY') this.dryModeService.updateCharacteristic(this.platform.Characteristic.On, false);
        if (mode !== 'QUIET') this.quietModeService.updateCharacteristic(this.platform.Characteristic.On, false);
      } catch (error) {
        this.platform.log.error(`Failed to set mode ${mode}:`, error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    } else {
      // User tapped the currently active mode to turn it off - we bounce it back to true
      // since the device must always have an active mode if it is running.
      this.platform.log.debug(`Ignoring attempt to visually turn off ${mode} mode`);
      setTimeout(() => {
        const targetService = mode === 'AUTO' ? this.autoModeService : mode === 'DRY' ? this.dryModeService : this.quietModeService;
        targetService.updateCharacteristic(this.platform.Characteristic.On, true);
      }, 100);
    }
  }
}
