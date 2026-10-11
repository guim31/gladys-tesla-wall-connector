# Single-phase sequences

The `evse_state` sequences a user read on a real Wall Connector gen 3 on a
single-phase supply (October 2026), with a Tesla and with a plug-in hybrid of
another make: plugged in outside the charging schedule (7), waiting (9),
charging (11), ready (4), unplugging (21); and for the other car plugging in
(12), charging (10), end of session (13).

Only the state sequences are real. The other values of `sequences.json` (each
step is merged over `base`) are made up, anonymized and plausible: no serial
number, address or reading of the user's charger.
