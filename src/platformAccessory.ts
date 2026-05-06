import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { ElectroluxDehumidifierPlatform } from './platform.js';
import type { ApplianceState } from './electroluxApi.js';

/**
 * Platform Accessory
 * Exposes a HumidifierDehumidifier service with only:
 * - Active (On/Off switch)
 * - Current Relative Humidity (sensor)
 *
 * Design note: ALL `onGet` handlers return cached values synchronously. Never await the
 * Electrolux API inside a characteristic getter — HomeKit has a short deadline, and a
 * slow cloud call makes the whole accessory show "Not Responding" in Apple Home.
 * Fresh values are delivered via background polling + `updateCharacteristic`.
 */
export class ElectroluxDehumidifierAccessory {
  private dehumidifierService: Service;
  private isShuttingDown = false;
  private shutdownTimer: NodeJS.Timeout | null = null;

  // Optimistic override: right after setActive, trust the user's intent for a short window
  // because the API's applianceState can lag behind commands by several seconds.
  private optimisticActiveUntil = 0;
  private optimisticActive: boolean | null = null;
  private static readonly OPTIMISTIC_WINDOW_MS = 10_000;

  // Background polling so HomeKit always has a fresh value without us ever blocking
  // inside an onGet handler.
  private static readonly POLL_INTERVAL_MS = 30_000;
  private pollTimer: NodeJS.Timeout | null = null;

  // Last known cached values — these are what `onGet` returns.
  private lastHumidity = 50;
  private lastActive = false;

  constructor(
    private readonly platform: ElectroluxDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Electrolux')
      .setCharacteristic(this.platform.Characteristic.Model, 'Dehumidifier')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.uniqueId);

    // Remove leftover services from older plugin versions (Fan, mode switches, etc.)
    // but DO NOT remove the HumidifierDehumidifier service if it already exists — ripping
    // it out and re-adding it on every restart gives its characteristics new IIDs, which
    // causes Apple Home to show "Not Responding" until the accessory is re-paired.
    const keepUUIDs = new Set([
      this.platform.Service.AccessoryInformation.UUID,
      this.platform.Service.HumidifierDehumidifier.UUID,
    ]);
    for (const service of this.accessory.services.slice()) {
      if (!keepUUIDs.has(service.UUID)) {
        this.accessory.removeService(service);
      }
    }

    // Reuse existing HumidifierDehumidifier service if cached; otherwise create it.
    this.dehumidifierService =
      this.accessory.getService(this.platform.Service.HumidifierDehumidifier) ??
      this.accessory.addService(
        this.platform.Service.HumidifierDehumidifier,
        accessory.context.device.displayName,
      );

    // Lock target state to DEHUMIDIFIER only.
    // Must set the value before restricting validValues, otherwise the default (0) falls outside the new range.
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
      .updateValue(this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER)
      .setProps({
        validValues: [this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER],
      })
      .onGet(() => this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER)
      .onSet(() => { /* no-op */ });

    // All getters return synchronously from cache.
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
      .onGet(() => this.cachedCurrentState());

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(() => this.cachedActive())
      .onSet(this.setActive.bind(this));

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(() => this.lastHumidity);

    // Remove the target humidity slider if it's present (older HAP versions auto-added it).
    if (this.dehumidifierService.testCharacteristic(
      this.platform.Characteristic.RelativeHumidityDehumidifierThreshold,
    )) {
      const targetHumidityChar = this.dehumidifierService.getCharacteristic(
        this.platform.Characteristic.RelativeHumidityDehumidifierThreshold,
      );
      this.dehumidifierService.removeCharacteristic(targetHumidityChar);
    }

    // Remove rotation speed only if it was previously attached.
    if (this.dehumidifierService.testCharacteristic(this.platform.Characteristic.RotationSpeed)) {
      const rotationSpeed = this.dehumidifierService.getCharacteristic(this.platform.Characteristic.RotationSpeed);
      this.dehumidifierService.removeCharacteristic(rotationSpeed);
    }

    // Kick off background polling. First refresh runs shortly after startup so we don't
    // slam the API right as Homebridge is coming up, and we use unref() so the timer
    // doesn't keep the process alive during shutdown.
    this.pollTimer = setInterval(
      () => this.refreshFromApi(),
      ElectroluxDehumidifierAccessory.POLL_INTERVAL_MS,
    );
    this.pollTimer.unref?.();
    setTimeout(() => this.refreshFromApi(), 2_000);
  }

  // ─── Cached getters (never touch the API) ─────────────────────────

  private cachedActive(): CharacteristicValue {
    if (this.isShuttingDown) {
      return this.platform.Characteristic.Active.INACTIVE;
    }
    if (this.optimisticActive !== null && Date.now() < this.optimisticActiveUntil) {
      return this.optimisticActive
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;
    }
    return this.lastActive
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  private cachedCurrentState(): CharacteristicValue {
    if (this.isShuttingDown) {
      return this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    }
    if (this.optimisticActive !== null && Date.now() < this.optimisticActiveUntil) {
      return this.optimisticActive
        ? this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
        : this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    }
    return this.lastActive
      ? this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
      : this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
  }

  // ─── Background refresh (push values into HomeKit) ────────────────

  private async refreshFromApi(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    try {
      const state = await this.platform.electroluxApi.getApplianceState();
      this.lastActive = this.isDeviceOn(state);
      this.sanitizeHumidity(state.sensorHumidity); // updates this.lastHumidity

      this.dehumidifierService.updateCharacteristic(
        this.platform.Characteristic.Active,
        this.cachedActive(),
      );
      this.dehumidifierService.updateCharacteristic(
        this.platform.Characteristic.CurrentHumidifierDehumidifierState,
        this.cachedCurrentState(),
      );
      this.dehumidifierService.updateCharacteristic(
        this.platform.Characteristic.CurrentRelativeHumidity,
        this.lastHumidity,
      );
    } catch (error) {
      // Background polling errors are debug only — stale cache is fine, HomeKit still gets a value.
      this.platform.log.debug('Background refresh failed:', error instanceof Error ? error.message : error);
    }
  }

  // ─── ON/OFF detection ──────────────────────────────────────────────

  /**
   * Decide whether the appliance should be reported as ON based on a fresh API state.
   * The API's `applianceState` can be RUNNING / OFF / IDLE / etc.
   *   1. applianceState === 'OFF' => definitely off
   *   2. applianceState === 'RUNNING' => definitely on
   *   3. Otherwise fall back to mode being a running-capable mode
   */
  private isDeviceOn(state: ApplianceState): boolean {
    if (state.applianceState === 'OFF') {
      return false;
    }
    if (state.applianceState === 'RUNNING') {
      return true;
    }
    const mode = state.mode ?? '';
    return mode === 'AUTO' || mode === 'DRY' || mode === 'QUIET';
  }

  // ─── setActive (the only handler that hits the API) ───────────────

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

        // Optimistically report ON while the API catches up with the command.
        this.optimisticActive = true;
        this.optimisticActiveUntil = Date.now() + ElectroluxDehumidifierAccessory.OPTIMISTIC_WINDOW_MS;
        this.lastActive = true;

        await this.platform.electroluxApi.turnOn();

        // Nudge HomeKit so the UI refreshes immediately.
        this.dehumidifierService.updateCharacteristic(
          this.platform.Characteristic.CurrentHumidifierDehumidifierState,
          this.platform.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING,
        );
        this.dehumidifierService.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.platform.Characteristic.Active.ACTIVE,
        );

        // Schedule a follow-up poll so the cache catches up with reality.
        setTimeout(() => this.refreshFromApi(), 3_000);
      } else {
        // 15-minute fan cooldown before actual shutdown
        this.platform.log.info('設備已進入送風冷卻模式，將於 15 分鐘後自動關閉。');
        this.isShuttingDown = true;
        this.optimisticActive = false;
        this.optimisticActiveUntil = Date.now() + ElectroluxDehumidifierAccessory.OPTIMISTIC_WINDOW_MS;
        this.lastActive = false;

        try {
          await this.platform.electroluxApi.setMode('QUIET');
        } catch (e) {
          this.platform.log.warn('Failed to set QUIET mode for cooldown', e);
        }

        this.dehumidifierService.updateCharacteristic(
          this.platform.Characteristic.Active,
          this.platform.Characteristic.Active.INACTIVE,
        );
        this.dehumidifierService.updateCharacteristic(
          this.platform.Characteristic.CurrentHumidifierDehumidifierState,
          this.platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE,
        );

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
          this.refreshFromApi();
        }, 15 * 60 * 1000);
      }
    } catch (error) {
      // Clear optimistic state so a failed command doesn't leave the UI stuck.
      this.optimisticActive = null;
      this.optimisticActiveUntil = 0;
      this.platform.log.error('Failed to set active state:', error);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  // ─── Value validation ─────────────────────────────────────────────

  private sanitizeHumidity(raw: unknown): number {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      this.platform.log.debug('Invalid humidity reading, keeping last known value:', raw);
      return this.lastHumidity;
    }
    this.lastHumidity = n;
    return n;
  }
}
