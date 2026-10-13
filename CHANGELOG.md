# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.3.1] - 2026-10-13

### Changed

- Quieter logs: a charger that stops answering is reported once, when it is
  flagged unreachable (at once for an address never seen), then once when it
  answers again, instead of a line on the first and third missed read
  of every outage. Gladys refusing the states (while it restarts) is one
  warning and one line when it accepts them again. A single slow answer and
  the scene triggers fired only show at debug level (`LOG_LEVEL=debug`).
- Gladys integration SDK 0.15 and up-to-date development tools.

### Fixed

- A device answering at a charger's address without a serial number is no
  longer remembered in the saved state under an empty name.

## [1.3.0] - 2026-10-11

### Changed

- Widget: three tiles on one line, power, current and the energy of the
  session ("This session" / "Last session", in kWh with one decimal, short
  enough for a third of a phone's width). The total stays a row, in whole kWh
  with the thousands separator of the language ("8,597 kWh"), in MWh from
  100,000 kWh only. The French tile reads "Session finie" once the car is
  unplugged: "Dernière session" did not fit.

## [1.2.0] - 2026-10-11

### Added

- German and Spanish, the other two languages of the Gladys interface: the
  manifest (configuration, actions, scene triggers, widget), the action and
  status messages, the widget, the charger states, and the feature names
  ("Device names language" setting). The user documentation stays in English
  and French, the only two the store re-hosts.

### Changed

- Widget: the power and current tiles side by side on one line, then the
  session energy and the total as the first rows under them. Gladys 5.1.4 puts
  every tile in one row that wraps after three, with no column setting: four
  tiles showed three plus one.
- History: the power, the vehicle current, the grid voltage and the handle
  temperature are sent to Gladys only on a significant change (50 W, or 2 %
  during a charge; 0.5 A; 2 V; 1 °C), on the return to 0 for the power and the
  current, and once an hour. A real charger stored 2,827 voltage values in
  under 12 hours; expect a few dozen a day now.

### Fixed

- "Charging state" no longer stays on "Charging" once the car is unplugged: it
  turns to "Idle".

## [1.1.0] - 2026-10-11

### Added

- The widget shows the charging time of the session, followed by the
  integration (contactor closed), next to the time since the car was plugged
  in; both are reset when the car is unplugged.
- Charger states 12, 13 (seen with a non-Tesla car) and 21 (a Tesla being
  unplugged) are known; 10, 12 and 13 say "likely non-Tesla", from a single
  real test.

### Changed

- Without a search range, the search sweeps the network of Gladys, learnt from
  the devices answering an SSDP search made by Gladys (a new network capture,
  shown at install time), instead of `192.168.1.0/24` and `192.168.0.0/24`,
  which remain the last resort. The search range is presented as an advanced
  setting.
- Widget: power and current first, then the session energy ("Last session"
  when no car is plugged in) and the total, rounded to fit its tile (MWh from
  1,000 kWh). "Session duration" becomes "Plugged in for".
- "Charging finished" also fires when the charge stops with the car still
  plugged in (states 9, 4, 7) or ends with the unplugging (13, 21), as a real
  Tesla does, and no longer fires without a charge before it.
- The documentation says the integration was tested on a single-phase gen 3
  charger; three-phase is still untested.

### Fixed

- State 7 with a car plugged in (outside its charging schedule) is no longer
  shown as an error nor published as a faulted connector: an error only without
  a car or with an alert. Plugging in outside the schedule now fires "car
  plugged in".
- A search that finds nothing, or an unusable search range, now shows in red
  instead of green.

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

[Unreleased]: https://github.com/guim31/gladys-tesla-wall-connector/compare/v1.3.1...HEAD
[1.3.1]: https://github.com/guim31/gladys-tesla-wall-connector/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/guim31/gladys-tesla-wall-connector/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/guim31/gladys-tesla-wall-connector/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/guim31/gladys-tesla-wall-connector/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/guim31/gladys-tesla-wall-connector/releases/tag/v1.0.1
