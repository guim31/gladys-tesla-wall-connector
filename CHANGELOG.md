# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-10

### Added

- Tesla Wall Connector gen 3, read on the home network without any account:
  connector and charging state, status in words, charging power, session
  energy, total energy delivered (kWh index for the energy monitoring), grid
  voltage, vehicle current and handle temperature. Read every 15 seconds, only
  changes are sent; flagged unreachable after three missed reads.
- Scene triggers: car plugged in, car unplugged, charging started, charging
  finished, with the session energy.
- Dashboard widget "Tesla Wall Connector".
- "Search for Wall Connectors": finds the chargers on a range of the home
  network and adds them to the configuration.
- "Test the Wall Connectors": what each configured address answers.
- The Wall Connector support of the Tesla integration 1.1.0 moves here, with
  the same feature, trigger and widget keys; the documentation explains how to
  move a charger from one integration to the other.

[Unreleased]: https://github.com/guim31/gladys-tesla-wall-connector/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-tesla-wall-connector/releases/tag/v1.0.1
