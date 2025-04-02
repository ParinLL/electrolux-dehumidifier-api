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
    
    // Update switch service
    this.switchService.updateCharacteristic(
      this.platform.Characteristic.On,
      this.currentState.applianceState === 'RUNNING',
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
   * Handle "SET" requests for the On characteristic
   */
  async setOn(value: CharacteristicValue) {
    this.platform.log.debug('Set On ->', value);
    
    try {
      if (value) {
        // Turn on with AUTO mode and clean air mode ON
        await this.platform.electroluxApi.turnOn();
      } else {
        // Turn off
        await this.platform.electroluxApi.turnOff();
      }
    } catch (error) {
      this.platform.log.error('Failed to set on state:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle "GET" requests for the On characteristic
   */
  async getOn(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      try {
        this.currentState = await this.platform.electroluxApi.getApplianceState();
      } catch (error) {
        this.platform.log.error('Failed to get on state:', error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    const isOn = this.currentState.applianceState === 'RUNNING';
    this.platform.log.debug('Get On ->', isOn);
    return isOn;
  }

}
