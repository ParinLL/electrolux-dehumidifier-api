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
  private fanService: Service;
  private humidityService: Service;
  private airPurifierService: Service;
  
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
    
    // Configure the humidifier service
    this.humidifierService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));
    
    this.humidifierService.getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
      .onGet(this.getCurrentHumidifierDehumidifierState.bind(this));
    
    this.humidifierService.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
      .setProps({
        validValues: [this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER],
      })
      .onGet(this.getTargetHumidifierDehumidifierState.bind(this));
    
    this.humidifierService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentRelativeHumidity.bind(this));
    
    this.humidifierService.getCharacteristic(this.platform.Characteristic.RelativeHumidityDehumidifierThreshold)
      .setProps({
        minValue: 40,
        maxValue: 60,
        minStep: 5,
      })
      .onSet(this.setRelativeHumidityDehumidifierThreshold.bind(this))
      .onGet(this.getRelativeHumidityDehumidifierThreshold.bind(this));
    
    // Create the fan service for fan speed control
    this.fanService = this.accessory.getService('Fan Speed') || 
      this.accessory.addService(this.platform.Service.Fanv2, 'Fan Speed', 'fanspeed');
    
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, 'Fan Speed');
    
    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getFanActive.bind(this));
    
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 50,
      })
      .onSet(this.setRotationSpeed.bind(this))
      .onGet(this.getRotationSpeed.bind(this));
    
    // Create the humidity sensor service
    this.humidityService = this.accessory.getService('Humidity Sensor') || 
      this.accessory.addService(this.platform.Service.HumiditySensor, 'Humidity Sensor', 'humiditysensor');
    
    this.humidityService.setCharacteristic(this.platform.Characteristic.Name, 'Humidity Sensor');
    
    this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentRelativeHumidity.bind(this));
    
    // Create the air purifier service for clean air mode
    this.airPurifierService = this.accessory.getService('Clean Air Mode') || 
      this.accessory.addService(this.platform.Service.Switch, 'Clean Air Mode', 'cleanairmode');
    
    this.airPurifierService.setCharacteristic(this.platform.Characteristic.Name, 'Clean Air Mode');
    
    this.airPurifierService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setCleanAirMode.bind(this))
      .onGet(this.getCleanAirMode.bind(this));
    
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
    
    this.humidifierService.updateCharacteristic(
      this.platform.Characteristic.RelativeHumidityDehumidifierThreshold,
      this.currentState.targetHumidity,
    );
    
    // Update fan service
    this.fanService.updateCharacteristic(
      this.platform.Characteristic.Active,
      this.currentState.applianceState === 'RUNNING' ? 1 : 0,
    );
    
    this.fanService.updateCharacteristic(
      this.platform.Characteristic.RotationSpeed,
      this.getFanSpeedValue(this.currentState.fanSpeedSetting),
    );
    
    // Update humidity sensor
    this.humidityService.updateCharacteristic(
      this.platform.Characteristic.CurrentRelativeHumidity,
      this.currentState.sensorHumidity,
    );
    
    // Update air purifier
    this.airPurifierService.updateCharacteristic(
      this.platform.Characteristic.On,
      this.currentState.cleanAirMode === 'ON',
    );
  }
  
  /**
   * Convert fan speed string to numeric value
   */
  private getFanSpeedValue(speed: string): number {
    switch (speed) {
    case 'LOW':
      return 33;
    case 'MIDDLE':
      return 66;
    case 'HIGH':
      return 100;
    default:
      return 0;
    }
  }
  
  /**
   * Convert numeric value to fan speed string
   */
  private getFanSpeedString(value: number): 'LOW' | 'MIDDLE' | 'HIGH' {
    if (value <= 33) {
      return 'LOW';
    } else if (value <= 66) {
      return 'MIDDLE';
    } else {
      return 'HIGH';
    }
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
        // Turn on - use AUTO mode
        await this.platform.electroluxApi.setMode('AUTO');
      } else {
        // TODO: Implement proper turn off functionality
        // For now, we'll set it to DRY mode with high humidity to effectively turn it off
        await this.platform.electroluxApi.setMode('DRY');
        await this.platform.electroluxApi.setTargetHumidity(60);
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

  /**
   * Handle "SET" requests for the RelativeHumidityDehumidifierThreshold characteristic
   */
  async setRelativeHumidityDehumidifierThreshold(value: CharacteristicValue) {
    this.platform.log.debug('Set RelativeHumidityDehumidifierThreshold ->', value);
    
    try {
      await this.platform.electroluxApi.setTargetHumidity(value as number);
    } catch (error) {
      this.platform.log.error('Failed to set target humidity:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle "GET" requests for the RelativeHumidityDehumidifierThreshold characteristic
   */
  async getRelativeHumidityDehumidifierThreshold(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      try {
        this.currentState = await this.platform.electroluxApi.getApplianceState();
      } catch (error) {
        this.platform.log.error('Failed to get target humidity:', error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    const targetHumidity = this.currentState.targetHumidity;
    this.platform.log.debug('Get RelativeHumidityDehumidifierThreshold ->', targetHumidity);
    return targetHumidity;
  }

  /**
   * Handle "GET" requests for the fan Active characteristic
   */
  async getFanActive(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      try {
        this.currentState = await this.platform.electroluxApi.getApplianceState();
      } catch (error) {
        this.platform.log.error('Failed to get fan active state:', error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    const isActive = this.currentState.applianceState === 'RUNNING' ? 1 : 0;
    this.platform.log.debug('Get Fan Active ->', isActive);
    return isActive;
  }

  /**
   * Handle "SET" requests for the RotationSpeed characteristic
   */
  async setRotationSpeed(value: CharacteristicValue) {
    this.platform.log.debug('Set RotationSpeed ->', value);
    
    try {
      const speed = this.getFanSpeedString(value as number);
      await this.platform.electroluxApi.setFanSpeed(speed);
    } catch (error) {
      this.platform.log.error('Failed to set fan speed:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle "GET" requests for the RotationSpeed characteristic
   */
  async getRotationSpeed(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      try {
        this.currentState = await this.platform.electroluxApi.getApplianceState();
      } catch (error) {
        this.platform.log.error('Failed to get fan speed:', error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    const speed = this.getFanSpeedValue(this.currentState.fanSpeedSetting);
    this.platform.log.debug('Get RotationSpeed ->', speed);
    return speed;
  }

  /**
   * Handle "SET" requests for the Clean Air Mode On characteristic
   */
  async setCleanAirMode(value: CharacteristicValue) {
    this.platform.log.debug('Set Clean Air Mode ->', value);
    
    try {
      await this.platform.electroluxApi.setCleanAirMode(value ? 'ON' : 'OFF');
    } catch (error) {
      this.platform.log.error('Failed to set clean air mode:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Handle "GET" requests for the Clean Air Mode On characteristic
   */
  async getCleanAirMode(): Promise<CharacteristicValue> {
    if (!this.currentState) {
      try {
        this.currentState = await this.platform.electroluxApi.getApplianceState();
      } catch (error) {
        this.platform.log.error('Failed to get clean air mode:', error);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    const isOn = this.currentState.cleanAirMode === 'ON';
    this.platform.log.debug('Get Clean Air Mode ->', isOn);
    return isOn;
  }
}
