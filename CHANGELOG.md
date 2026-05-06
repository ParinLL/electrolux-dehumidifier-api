# Changelog

All notable changes to this project will be documented in this file.

## [1.6.7] - 2026-05-06
### Fixed
- Fixed the dehumidifier disappearing from Apple Home after restarting the plugin (while still visible in Homebridge). The accessory now declares the `AIR_DEHUMIDIFIER` HomeKit category for both newly registered and restored-from-cache accessories, so Home knows how to render the tile.
- Persist the accessory to Homebridge's cache **after** the accessory class has cleaned up stale services, preventing leftover services from being rehydrated on each restart.

## [1.6.6] - 2026-05-06
### Fixed
- Fixed Apple Home showing the dehumidifier tile as "Not Responding" even though humidity was updating. Characteristic `onGet` handlers no longer await the Electrolux API — they return instantly from cached values, so HomeKit's read deadline can never be missed. Fresh state is delivered via a 30s background poll plus immediate push after `setActive`.
- Background poll timer is now `unref()`-ed so it can't keep the Homebridge process alive during shutdown.

## [1.6.5] - 2026-05-06
### Fixed
- Fixed "Accessory Not Responding" in Apple Home after every Homebridge restart. The previous startup code removed and re-added the HumidifierDehumidifier service each time, giving its characteristics brand-new IIDs that no longer matched the ones the Home app had cached. The service is now reused across restarts, and only leftover services from older plugin versions (Fan, mode switches) are removed.
- Stopped churning `RelativeHumidityDehumidifierThreshold` / `RotationSpeed` characteristics on every boot; they're only removed when actually present.

## [1.6.4] - 2026-05-06
### Fixed
- Fixed "Accessory Not Responding" appearing in Apple Home while Homebridge itself showed everything as healthy.
  - Loaded the accessory class synchronously so characteristic handlers are wired up before the HAP bridge publishes.
  - Added an 8s axios timeout so a hung Electrolux API call can no longer stall HomeKit past its deadline.
  - Added a 3s state cache with in-flight request dedupe so HomeKit's parallel reads hit the API only once.
  - Background polling every 60s pushes fresh values to HomeKit so a single failed on-demand read no longer trips "Not Responding".
  - On-demand reads now degrade to the last known value instead of throwing `SERVICE_COMMUNICATION_FAILURE`.
  - Sanitized humidity readings so malformed API responses (NaN / out of 0–100) don't poison the characteristic.

## [1.5.4] - 2026-04-23
### Fixed
- Fixed a bug where toggling the device OFF in the Home app would cause it to visually bounce back to the ON state. Background polling overrides are now properly skipping state overrides during the 20-minute shutdown sequence.

## [1.5.3] - 2026-04-23
### Removed
- Removed the standalone `QUIET` mode UI switch to achieve maximum iOS Home app minimalism. The 20-minute `QUIET` mode cooldown upon shutting down the device is fully preserved internally.

## [1.5.2] - 2026-04-23
### Fixed
- Fixed an issue where the Home app would improperly display the dehumidifier state as "關閉" (Off) when it was actually actively idling. We now force the `CurrentHumidifierDehumidifierState` to statically report `DEHUMIDIFYING` as long as the device has power, ensuring the HomeKit UI switch accurately tracks the ON state.

## [1.5.1] - 2026-04-23
### Changed
- Removed the `RelativeHumidityDehumidifierThreshold` characteristic completely to prevent Apple Home from rendering the giant target humidity slider UI, resulting in a cleaner, button-centric layout.

## [1.5.0] - 2026-04-23
### Changed
- Major Architectural Change: Upgraded the accessory to use Apple's native `HumidifierDehumidifier` service type instead of fragmented generic switches.
- User Interface: Consolidated power, target humidity, current humidity sensing, mode selection (Auto/Dehumidifier), and fan speed (mapped seamlessly with Apple's 33% step slider for 3-gear input) into a single, cohesive HomeKit tile.
- Notice: Due to Apple's native menu limitations, the `QUIET` mode has been maintained as a separate switch.

## [1.4.1] - 2026-04-23
### Added
- Exported Fan Speed control natively to HomeKit as a `Fanv2` service (Rotation Speed 0~100%).
- Exported Mode Controls (`AUTO`, `DRY`, `QUIET`) natively to HomeKit via dedicated toggle switches to circumvent Apple Home UI limitations. Toggling one mode visually disables the others to provide a mutually exclusive control interface.


## [1.3.1] - 2026-04-22
### Added
- Implemented a 20-minute cooldown mechanism using `QUIET` mode when the dehumidifier is turned off via HomeKit, allowing internal components to dry before a complete shutdown.

## [1.2.0] - Prior Release
- Base functionality for Electrolux dehumidifiers including switch capability and humidity sensor readings.
