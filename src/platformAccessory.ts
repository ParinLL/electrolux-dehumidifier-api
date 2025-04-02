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
  private humidifierService: Service;
  
  // Keep track of the current state
  private currentState: ApplianceState | null = null;

  constructor(
    private readonly platform: ElectroluxDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Electrolux')
      .setCharacteristic(this.platform.Characteristic.Model, 'Dehumidifier')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.uniqueId);

    // Create the humidifier service (main service)
    this.humidifierService = this.accessory.getService(this.platform.Service.HumidifierDehumidifier) || 
      this.accessory.addService(this.platform.Service.HumidifierDehumidifier);
    
    // Set the service name
    this.humidifierService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.displayName);
    
    // Configure the humidifier service with only on/off functionality
    this.humidifierService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));
    
    this.humidifierService.getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
      .onGet(this.getCurrentHumidifierDehumidifierState.bind(this));
    
    this.humidifierService.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
      .setProps({
        validValues: [this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER],
      })
      .onSet(() => {
        // Always accept the value but ensure it's DEHUMIDIFIER
        return this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER;
      })
      .onGet(this.getTargetHumidifierDehumidifierState.bind(this));
    
    this.humidifierService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentRelativeHumidity.bind(this));
    
    // Set up a method to handle state updates
    this.setupStateUpdateHandler();
    
    // Initialize state if available
    if (this.accessory.context.state) {
      this.currentState = this.accessory.context.state;
      this.updateAllCharacteristics();
    }
  }
  
  /**
   * Update all characteristics based on the current state
   */
  private updateAllCharacteristics() {
    if (!this.currentState) {
      return;
    }
    
    // Update humidifier service
    this.humidifierService.updateCharacteristic(
      this.platform.Characteristic.Active,
      this.currentState.applianceState === 'RUNNING' ? 1 : 0,
    );
    
    this.humidifierService.updateCharacteristic(
      this.platform.Characteristic.CurrentHumidifierDehumidifierState,
      this.currentState.applianceState === 'RUNNING' 
        ? this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
        : this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE,
    );
    
    this.humidifierService.updateCharacteristic(
      this.platform.Characteristic.TargetHumidifierDehumidifierState,
      this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER,
    );
    
    this.humidifierService.updateCharacteristic(
      this.platform.Characteristic.CurrentRelativeHumidity,
      this.currentState.sensorHumidity,
    );
  }
  
  
  /**
   * Set up a handler for state updates
   * This is called when the platform updates the accessory context with new state
   */
  private setupStateUpdateHandler() {
    // Monitor for changes to the accessory context
    this.platform.api.on('didFinishLaunching', () => {
      // Check for state updates periodically
      setInterval(() => {
        if (this.accessory.context.state && 
            (!this.currentState || 
             JSON.stringify(this.accessory.context.state) !== JSON.stringify(this.currentState))) {
          this.currentState = this.accessory.context.state;
          this.updateAllCharacteristics();
        }
      }, 1000); // Check every second
    });
  }

  /**
   * Handle "SET" requests for the Active characteristic
   */
  async setActive(value: CharacteristicValue) {
    this.platform.log.debug('Set Active ->', value);
    
    try {
      if (value === 1) {
        // Turn on with AUTO mode and clean air mode ON
        await this.platform.electroluxApi.turnOn();
      } else {
        // Turn off
        await this.platform.electroluxApi.turnOff();
      }
    } catch (error) {
      this.platform.log.error('Failed to set active state:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle "GET" requests for the Active characteristic
   */
  async getActive(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      try {
        this.currentState = await this.platform.electroluxApi.getApplianceState();
      } catch (error) {
        this.platform.log.error('Failed to get active state:', error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    const isActive = this.currentState.applianceState === 'RUNNING' ? 1 : 0;
    this.platform.log.debug('Get Active ->', isActive);
    return isActive;
  }

  /**
   * Handle "GET" requests for the CurrentHumidifierDehumidifierState characteristic
   */
  async getCurrentHumidifierDehumidifierState(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      try {
        this.currentState = await this.platform.electroluxApi.getApplianceState();
      } catch (error) {
        this.platform.log.error('Failed to get current state:', error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    const state = this.currentState.applianceState === 'RUNNING'
      ? this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
      : this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    
    this.platform.log.debug('Get CurrentHumidifierDehumidifierState ->', state);
    return state;
  }

  /**
   * Handle "GET" requests for the TargetHumidifierDehumidifierState characteristic
   */
  async getTargetHumidifierDehumidifierState(): Promise<CharacteristicValue> {
    // We only support dehumidifier mode
    return this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER;
  }

  /**
   * Handle "GET" requests for the CurrentRelativeHumidity characteristic
   */
  async getCurrentRelativeHumidity(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      try {
        this.currentState = await this.platform.electroluxApi.getApplianceState();
      } catch (error) {
        this.platform.log.error('Failed to get humidity:', error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    const humidity = this.currentState.sensorHumidity;
    this.platform.log.debug('Get CurrentRelativeHumidity ->', humidity);
    return humidity;
  }

}
