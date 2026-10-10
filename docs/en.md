# Tesla Wall Connector

Follow your **Tesla Wall Connector gen 3** in Gladys: charger and charging
state, power, session energy and total energy delivered, voltage, current,
handle temperature. The charger is read **directly on your home network**: no
Tesla account, no cloud, no subscription.

> **Built without the hardware: feedback welcome.** This integration was built
> without a charger, on sample answers taken from the tests of the
> `tesla-wall-connector` library (the one Home Assistant uses). The power
> computation, the charger states and the network search still need checking on
> a real charger. If something looks wrong, say so on the Gladys forum.

This integration is not affiliated with Tesla, Inc.

## What you need

- Gladys **5.1** or later.
- A **Wall Connector gen 3** (the Wi-Fi model), connected to your Wi-Fi (Tesla
  One app). The gen 2 and the Universal Wall Connector have no such local API
  and are not supported.
- Gladys and the charger on the same home network.

## Getting started

1. Install the integration from the catalog, then open its **Configuration**
   tab.
2. Tell it where the charger is, either way:
   - **you know its IP address** (in your router's interface): type it in
     **Wall Connector addresses** (several chargers: separated by commas), save;
   - **you do not**: press **Search for Wall Connectors** at the bottom of the
     page (see [Automatic search](#automatic-search)).
3. Open the **Discovery** tab and add the charger.
4. Optional: press **Test the Wall Connectors**: each address shows the end of
   the charger's serial number, its firmware and its state, or why it does not
   answer.

Give the charger a **fixed address** in your router, so it does not change. The
charger is identified by its serial number: if its address changes anyway, type
the new one (or search again) and the same device carries on, with its history.

### Settings

| Setting                      | Role                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wall Connector addresses** | IP address (or host name) of each charger, separated by commas. The search fills it in too.                                                                               |
| **Search range**             | Where to look for chargers: a network (`192.168.1.0/24`), a range (`192.168.1.10-192.168.1.60`) or addresses, separated by commas. Private addresses only, 1,024 at most. |
| **Temperature unit**         | Unit of the handle temperature as scenes compare it: automatic (°F on a North American charger, else °C), °C or °F. The dashboard always converts.                        |
| **Device names language**    | English or French feature names for new devices. Gladys keeps a feature's name once the device is created.                                                                |

## Automatic search

The Wall Connector does not announce itself on the network (no mDNS, no SSDP:
Home Assistant finds it through the DHCP server, which Gladys does not offer to
integrations). The **Search for Wall Connectors** button therefore tries each
address of a range: a quick connection to port 80 of each, then a call to the
charger API (`/api/1/version` and `/api/1/vitals`) on the few addresses that
answered, keeping only the answers shaped like a Wall Connector's.

The chargers found are **added to the configuration** and read at once: they
show up in the **Discovery** tab. A known charger found at a new address
replaces its old address. **Reload the page before saving the configuration
form again**, or it would put back the old addresses.

**Which range?** The integration runs in an isolated container: it cannot see
which network Gladys is on, hence the **Search range** setting. The "Searching
the network" block of the configuration shows the address your browser reaches
Gladys by: if it is `192.168.1.20`, the range is `192.168.1.0/24` (addresses
`192.168.1.1` to `192.168.1.254`). If you go through Gladys Plus or a name such
as `gladys.local`, look up the IP address of Gladys in your router.

Left empty, the search tries the network of the chargers already configured,
else `192.168.1.0/24` and `192.168.0.0/24`, the most common home networks.

A search takes a few seconds to a minute. It never leaves the home network:
only private addresses are accepted, 1,024 at most.

## What you get

| Feature                | Details                                                                   |
| ---------------------- | ------------------------------------------------------------------------- |
| Connector              | Available, occupied (a car is plugged in), unavailable, faulted           |
| Charging state         | Charging, vehicle connected, paused (car), idle                           |
| Status                 | The charger's own state in words (ready, negotiating, charging finished…) |
| Charging power         | W                                                                         |
| Session energy         | kWh delivered since the car was plugged in                                |
| Total energy delivered | Cumulative index in kWh, for the energy monitoring of Gladys              |
| Grid voltage, current  | V, A                                                                      |
| Handle temperature     | °C or °F (**Temperature unit** setting)                                   |

Everything is read-only: the charger's local API does not start, stop or limit
a charge (do it from the car or the Tesla app).

The charger is read every **15 seconds** (the total counter every minute), and
only what changes is sent to Gladys. After three missed reads in a row, the
charger shows as **unreachable** (badge on the device).

The charger reports voltages and currents, not the power: it is computed phase
by phase (three-phase in Europe), or as voltage × current on a North American
240 V split-phase supply (recognized by its 60 Hz grid).

## Energy monitoring

The **total energy delivered** is the charger's own counter. Gladys computes
the consumption per half hour and its cost from it, and files it **under your
main electric meter**: the charger is a sub-meter of your main meter, since its
energy goes through it too.

In a consumption widget, **do not tick both the main meter and the charger** if
you want a correct total: the charger's energy would be counted twice. Show
them in two widgets, or tick the main meter alone for the house total.

## Dashboard

The **Tesla Wall Connector** widget (Gladys 5.1+), set with the charger to
show: charging power, session and total energy, current, charger state, car
plugged in and session duration. No button: the local API is read-only.

## Scenes

Triggers, each one can be limited to one charger, with the session energy in
kWh:

- **Wall Connector: car plugged in**
- **Wall Connector: car unplugged**
- **Wall Connector started charging**
- **Wall Connector charging finished**

They only fire on an observed change: a restart of the integration neither
replays nor loses an event. Every feature above also works in scenes the usual
way ("when the charging power goes above 7,000 W"…).

## Were you using the charger in the Tesla/Teslemetry integration?

The charger had been added to the Tesla integration (version 1.1.0), which is
mostly for cars and Powerwall through the Teslemetry service. It now has its
own integration, this one, as in Home Assistant. The reading code is the same,
and so are the features, the trigger names and the widget.

Gladys ties each device to its integration: the charger of this integration is
therefore a **new device**, and the history of the old one is not carried over.
To move from one to the other:

1. **Install this integration**, type the charger address (the same as in the
   Tesla integration) or press **Search for Wall Connectors**, then add the
   charger from the **Discovery** tab.
2. **Update your scenes, widgets and energy monitoring**: pick the triggers of
   this integration (same names), the **Tesla Wall Connector** widget of this
   integration, and the new charger in the consumption widgets.
3. **Remove the old charger**: in the Tesla integration, empty the **Wall
   Connector addresses** field and save, then delete the old Wall Connector
   device. Deleting the device deletes its history too: keep it as long as you
   need it.

Both integrations can read the charger at the same time without trouble for
it, but the energy would then be counted twice in the energy monitoring, and
the triggers would fire twice: keep the charger on one side only. If you only
used the Tesla integration for the charger, you can uninstall it.

## Troubleshooting

- **"No Wall Connector answers"**: check the IP address in your router and that
  the charger is on the Wi-Fi (Tesla One app), then press **Test the Wall
  Connectors**.
- **The search finds nothing**: check the **Search range** (the charger's
  network, see above). A charger on another network (a separate "IoT" Wi-Fi, a
  VLAN) is searched with that network's range, if Gladys can reach it. A strict
  firewall on the Gladys machine (ufw) can also block the integrations' traffic
  to the home network.
- **The charger answers slowly**: common with this firmware; the integration
  waits up to 10 seconds and only flags it unreachable after three failures in
  a row.
- The integration logs what it does (searches, charger answers): open
  its logs from the integration's tab in Gladys.
