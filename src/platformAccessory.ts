import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ElectroluxDehumidifierPlatform } from './platform.js';

/**
 * Platform Accessory
 * Exposes a HumidifierDehumidifier service with only:
 * - Active (On/Off switch)
 * - Current Relative Humidity (sensor)
 */
export class ElectroluxDehumidifierAccessory {
  private dehumidifierService: Service;
  private isShuttingDown = false;
  private shutdownTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly platform: ElectroluxDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Electrolux')
      .setCharacteristic(this.platform.Characteristic.Model, 'Dehumidifier')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.uniqueId);

    // Remove stale services
    const services = this.accessory.services.slice();
    for (const service of services) {
      if (service.UUID !== this.platform.Service.AccessoryInformation.UUID) {
        this.accessory.removeService(service);
      }
    }

    // Create HumidifierDehumidifier service
    this.dehumidifierService = this.accessory.addService(
      this.platform.Service.HumidifierDehumidifier,
      accessory.context.device.displayName,
    );

    // Lock target state to DEHUMIDIFIER only
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
      .setProps({
        validValues: [this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER],
      })
      .onGet(() => this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER)
      .onSet(() => { /* no-op */ });

    // Current state
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
      .onGet(this.getCurrentState.bind(this));

    // Active (power on/off)
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    // Current relative humidity
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getCurrentHumidity.bind(this));

    // Remove the target humidity slider
    const targetHumidityChar = this.dehumidifierService.getCharacteristic(
      this.platform.Characteristic.RelativeHumidityDehumidifierThreshold,
    );
    this.dehumidifierService.removeCharacteristic(targetHumidityChar);

    // Remove rotation speed if it exists
    const rotationSpeed = this.dehumidifierService.getCharacteristic(this.platform.Characteristic.RotationSpeed);
    if (rotationSpeed) {
      this.dehumidifierService.removeCharacteristic(rotationSpeed);
    }
  }

  // ─── Active (On/Off) ───────────────────────────────────────────────

  async getActive(): Promise<CharacteristicValue> {
    if (this.isShuttingDown) {
      return this.platform.Characteristic.Active.INACTIVE;
    }

    try {
      const state = await this.platform.electroluxApi.getApplianceState();
      const isOn = state.applianceState === 'RUNNING';
      return isOn
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;
    } catch (error) {
      this.platform.log.error('Failed to get active state:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setActive(value: CharacteristicValue) {
    const turnOn = value === this.platform.Characteristic.Active.ACTIVE;
    this.platform.log.debug(`setActive: ${turnOn ? 'ON' : 'OFF'}`);

    try {
      if (turnOn) {
        if (this.shutdownTimer) {
          clearTimeout(this.shutdownTimer);
          this.shutdownTimer = null;
        }
        this.isShuttingDown = false;
        await this.platform.electroluxApi.turnOn();
      } else {
        // 15-minute fan cooldown before actual shutdown
        this.platform.log.info('設備已進入送風冷卻模式，將於 15 分鐘後自動關閉。');
        this.isShuttingDown = true;

        try {
          await this.platform.electroluxApi.setMode('QUIET');
        } catch (e) {
          this.platform.log.warn('Failed to set QUIET mode for cooldown', e);
        }

        if (this.shutdownTimer) {
          clearTimeout(this.shutdownTimer);
        }

        this.shutdownTimer = setTimeout(async () => {
          this.platform.log.info('15 分鐘送風結束，正在關閉設備。');
          try {
            await this.platform.electroluxApi.turnOff();
          } catch (error) {
            this.platform.log.error('Failed to turn OFF after cooldown:', error);
          }
          this.isShuttingDown = false;
          this.shutdownTimer = null;
        }, 15 * 60 * 1000);
      }
    } catch (error) {
      this.platform.log.error('Failed to set active state:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  // ─── Current State ─────────────────────────────────────────────────

  async getCurrentState(): Promise<CharacteristicValue> {
    if (this.isShuttingDown) {
      return this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    }

    try {
      const state = await this.platform.electroluxApi.getApplianceState();
      return state.applianceState === 'RUNNING'
        ? this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
        : this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    } catch (error) {
      this.platform.log.error('Failed to get current state:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  // ─── Humidity ──────────────────────────────────────────────────────

  async getCurrentHumidity(): Promise<CharacteristicValue> {
    try {
      const state = await this.platform.electroluxApi.getApplianceState();
      return state.sensorHumidity;
    } catch (error) {
      this.platform.log.error('Failed to get humidity:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
