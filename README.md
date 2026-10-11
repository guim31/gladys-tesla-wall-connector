# Tesla Wall Connector for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for the
**Tesla Wall Connector gen 3**, read directly on the home network: no Tesla
account, no cloud, no subscription.

> **Tested on a gen 3 charger on a single-phase supply; three-phase not
> tested.** A user ran it on a real charger with a Tesla and a non-Tesla
> plug-in hybrid (October 2026). The tests run on the sample answers of the
> `tesla-wall-connector` library's tests and on the state sequences of that
> real test (`test/fixtures/single-phase/`, made-up values). Reports from owners
> are very welcome on the Gladys forum.

**Not affiliated with Tesla, Inc.** Tesla and Wall Connector are trademarks of
Tesla, Inc.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## What it does

- **One device per charger**, keyed on its serial number (an IP change keeps
  the same device): connector state, charging state, status in words, charging
  power, session energy, total energy delivered (cumulative kWh index for the
  Gladys energy monitoring, as a sub-meter of the main meter), grid voltage,
  vehicle current, handle temperature. Read-only: the local API takes no
  command.
- **Scene triggers**: car plugged in, car unplugged, charging started, charging
  finished, each with the session energy.
- **Dashboard widget** "Tesla Wall Connector": live power and current, session
  and total energy, charger and car state, plugged-in time and charging time
  (followed by the integration). No button.
- **Search for Wall Connectors**: a configuration action that sweeps the
  network of Gladys (or a configured range) and adds the chargers it finds to
  the configuration.

It is the Wall Connector part of the
[Tesla integration](https://github.com/guim31/gladys-tesla) 1.1.0, moved to its
own integration (as Home Assistant keeps `tesla_wall_connector` apart from
`teslemetry`): same reading code, same feature keys, same trigger and widget
keys. Gladys prefixes every external id with the integration's selector, so a
charger moved from one integration to the other is a new device; the
[documentation](docs/en.md#were-you-using-the-charger-in-the-teslateslemetry-integration)
explains the move.

## Prerequisites

- Gladys **5.1.0** or later.
- A Wall Connector **gen 3** on the home Wi-Fi (gen 2 and the Universal Wall
  Connector have no local API).

## Installation

From Gladys: **Integrations → Store → Tesla Wall Connector → Install**, then,
in the **Configuration** tab, type the charger address or press **Search for
Wall Connectors**, and add the charger from the **Discovery** tab.

## How it works

- `GET http://<charger>/api/1/vitals` every 15 s, `/api/1/lifetime` every
  minute, `/api/1/version` once (serial number). No authentication. The client
  repairs the firmware's JSON glitches (`nan`, a missing closing brace), refuses
  redirects and answers over 64 KB, and only accepts plain host names and IP
  addresses.
- The power is computed per phase (three-phase), or grid voltage × vehicle
  current on a 60 Hz split-phase supply.
- Only **changed** states are published to Gladys, and every state is
  re-published when a device is created (Gladys drops the states of features
  that do not exist yet). After three missed reads in a row, the charger is
  flagged `unreachable`, else `local`.
- The charger states (`evse_state`) follow Home Assistant's table, corrected by
  a real single-phase test: 7 with a car plugged in and no alert is "outside
  the charging schedule", not a fault; 12, 10 and 13 (seen only with a
  non-Tesla car: "likely non-Tesla") and 21 (a Tesla unplugging) are known.
- The last address, energy index, session state and charging time of each
  charger are persisted under `/data`: a restart neither resets the index nor
  replays a trigger.
- **Search**: the charger announces itself neither in mDNS nor in SSDP, and the
  integration's container sits on a Docker bridge (`gladys-integrations`, never
  the host network) that sees no LAN broadcast and is not told the LAN address
  of Gladys. Unicast to the LAN does go through, so the search tries a TCP
  connection to port 80 of each address of a range (64 at a time, 1 s), then
  reads `/api/1/version` and `/api/1/vitals` on the open ones and keeps those
  shaped like a Wall Connector. The range is the configured one (private
  addresses only, 1,024 at most), else the /24 of the chargers already
  configured and the /24 networks of the devices answering an SSDP search
  (`upnp:rootdevice`) the core runs for the integration from the host network
  (manifest `network_discovery`), else `192.168.1.0/24` and `192.168.0.0/24`.
  Nothing found is an error (red in Gladys, which has no warning level for an
  action result).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store .   # store admission checks
```

`test/gladys-rules.test.js` checks the discovered device and every published
state (three-phase Europe charging, finished and unplugged, split-phase North
America, every unit and language setting) against the feature table of the
Gladys core (`test/fixtures/gladys-feature-table.json`). Tests never touch the
network. To run against a real Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="tesla-wall-connector" \
DATA_DIR=./data LOG_LEVEL=debug \
npm start
```

## Releasing

Releases are cut by the **Release** workflow (Actions → Release): it bumps the
version in `package.json` and the manifest, moves the `## [Unreleased]` section
of [`CHANGELOG.md`](CHANGELOG.md), tags, builds the multi-arch image to
`ghcr.io/guim31/gladys-tesla-wall-connector` and publishes the GitHub Release.
Never edit the versions by hand.

> A hand-pushed tag (`git tag vX.Y.Z && git push --tags`) triggers the same
> build and GitHub Release, but does not touch the files: bump `version` in
> `package.json` and in `gladys-assistant-integration.json` (with the
> `docker_image` tag) and commit it **before** tagging.

## Credits

- Started from the official
  [Gladys JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
  and built on [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
- The Wall Connector local API, its quirks and test answers follow the
  [`tesla-wall-connector`](https://github.com/einarhauks/tesla-wall-connector)
  Python library (MIT; its license, which covers the fixtures derived from its
  tests, is in [`test/fixtures/wall-connector/LICENSE`](test/fixtures/wall-connector/LICENSE))
  and the
  [Home Assistant Tesla Wall Connector integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/tesla_wall_connector)
  (Apache 2.0, @einarhauks, @sarabveer and the Home Assistant contributors).

## License

Apache-2.0
