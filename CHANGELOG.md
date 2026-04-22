# Changelog

All notable changes to this project will be documented in this file.
## [1.4.1] - 2026-04-23
### Added
- Exported Fan Speed control natively to HomeKit as a `Fanv2` service (Rotation Speed 0~100%).
- Exported Mode Controls (`AUTO`, `DRY`, `QUIET`) natively to HomeKit via dedicated toggle switches to circumvent Apple Home UI limitations. Toggling one mode visually disables the others to provide a mutually exclusive control interface.


## [1.3.1] - 2026-04-22
### Added
- Implemented a 20-minute cooldown mechanism using `QUIET` mode when the dehumidifier is turned off via HomeKit, allowing internal components to dry before a complete shutdown.

## [1.2.0] - Prior Release
- Base functionality for Electrolux dehumidifiers including switch capability and humidity sensor readings.
