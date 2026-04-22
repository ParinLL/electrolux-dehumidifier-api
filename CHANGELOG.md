# Changelog

All notable changes to this project will be documented in this file.
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
