// -----------------------------------------------------------------------------
// Messages shown to the user: connection status, action results, widget texts.
//
// Every entry is a `{ en, fr, de, es }` object, or a function returning one
// (the values inserted are addresses, numbers and firmware versions, never
// words). test/i18n.test.js walks this whole table: an entry missing a
// language, or empty, fails it.
// -----------------------------------------------------------------------------

export const MESSAGES = {
  // --- Connection status (Configuration tab) ---------------------------------
  noCharger: {
    en: 'Enter the address of your Wall Connector, or use “Search for Wall Connectors” below.',
    fr: 'Saisissez l’adresse de votre borne, ou utilisez « Rechercher les bornes » ci-dessous.',
    de: 'Gib die Adresse deines Wall Connectors ein oder nutze unten „Wall Connectors suchen“.',
    es: 'Introduzca la dirección de su Wall Connector o use «Buscar Wall Connectors» más abajo.',
  },
  unreachable: {
    en: 'No Wall Connector answers on the home network: check the addresses.',
    fr: 'Aucune Wall Connector ne répond sur le réseau local : vérifiez les adresses.',
    de: 'Kein Wall Connector antwortet im lokalen Netzwerk: Prüfe die Adressen.',
    es: 'Ningún Wall Connector responde en la red local: compruebe las direcciones.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Protokollen der Integration nach.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },

  // --- Search action -----------------------------------------------------------
  searchRunning: {
    en: 'A search is already running, wait for its result.',
    fr: 'Une recherche est déjà en cours, attendez son résultat.',
    de: 'Eine Suche läuft bereits, warte auf ihr Ergebnis.',
    es: 'Ya hay una búsqueda en curso, espere su resultado.',
  },
  badRange: (bad) => {
    const list = bad ? ` (${bad})` : '';
    return {
      en:
        `The search range of the configuration is not usable${list}.\n` +
        'Give private addresses of your home network, 1,024 at most: a network such as 192.168.1.0/24, or a range such as 192.168.1.10-192.168.1.60.',
      fr:
        `La plage de recherche de la configuration est inutilisable${list}.\n` +
        'Indiquez des adresses privées de votre réseau local, 1 024 au plus : un réseau comme 192.168.1.0/24, ou une plage comme 192.168.1.10-192.168.1.60.',
      de:
        `Der Suchbereich der Konfiguration ist nicht verwendbar${list}.\n` +
        'Gib private Adressen deines lokalen Netzwerks an, höchstens 1.024: ein Netzwerk wie 192.168.1.0/24 oder einen Bereich wie 192.168.1.10-192.168.1.60.',
      es:
        `El rango de búsqueda de la configuración no se puede usar${list}.\n` +
        'Indique direcciones privadas de su red local, 1024 como máximo: una red como 192.168.1.0/24 o un rango como 192.168.1.10-192.168.1.60.',
    };
  },
  searched: (count, where, seconds) => ({
    en: `${count} addresses searched (${where}) in ${seconds} s.`,
    fr: `${count} adresses explorées (${where}) en ${seconds} s.`,
    de: `${count} Adressen durchsucht (${where}) in ${seconds} s.`,
    es: `${count} direcciones exploradas (${where}) en ${seconds} s.`,
  }),
  gladysNetwork: (networks) => ({
    en: `Network of Gladys: ${networks}.`,
    fr: `Réseau de Gladys : ${networks}.`,
    de: `Netzwerk von Gladys: ${networks}.`,
    es: `Red de Gladys: ${networks}.`,
  }),
  defaultNetworks: {
    en: 'The network of Gladys could not be found (no device answered its SSDP search): the two most common home networks were tried.',
    fr: 'Le réseau de Gladys n’a pas pu être trouvé (aucun appareil n’a répondu à sa recherche SSDP) : les deux réseaux domestiques les plus courants ont été essayés.',
    de: 'Das Netzwerk von Gladys wurde nicht gefunden (kein Gerät hat auf seine SSDP-Suche geantwortet): Die zwei häufigsten Heimnetzwerke wurden versucht.',
    es: 'No se ha podido encontrar la red de Gladys (ningún dispositivo respondió a su búsqueda SSDP): se han probado las dos redes domésticas más habituales.',
  },
  searchIncomplete: {
    en: 'The search ran out of time before the end of the range.',
    fr: 'La recherche a manqué de temps avant la fin de la plage.',
    de: 'Der Suche ist vor dem Ende des Bereichs die Zeit ausgegangen.',
    es: 'La búsqueda se quedó sin tiempo antes del final del rango.',
  },
  noneFound: {
    en: 'No Wall Connector answered.',
    fr: 'Aucune Wall Connector n’a répondu.',
    de: 'Kein Wall Connector hat geantwortet.',
    es: 'Ningún Wall Connector ha respondido.',
  },
  noneFoundHelp: {
    en: 'Check that the charger is connected to your Wi-Fi (Tesla One app), then set the range of your home network in the configuration (e.g. 192.168.1.0/24), or type the charger address.',
    fr: 'Vérifiez que la borne est connectée à votre Wi-Fi (application Tesla One), puis indiquez la plage de votre réseau dans la configuration (ex. 192.168.1.0/24), ou saisissez l’adresse de la borne.',
    de: 'Prüfe, ob die Ladestation mit deinem WLAN verbunden ist (App Tesla One), und gib dann den Bereich deines Heimnetzwerks in der Konfiguration an (z. B. 192.168.1.0/24) oder trage die Adresse der Ladestation ein.',
    es: 'Compruebe que el cargador está conectado a su wifi (aplicación Tesla One) y luego indique el rango de su red local en la configuración (p. ej. 192.168.1.0/24) o introduzca la dirección del cargador.',
  },
  foundCount: (count) => ({
    en: `Wall Connector(s) found: ${count}.`,
    fr: `Borne(s) trouvée(s) : ${count}.`,
    de: `Gefundene Wall Connectors: ${count}.`,
    es: `Wall Connectors encontrados: ${count}.`,
  }),
  foundLine: (host, serial, firmware, outcome) => ({
    en: `• ${host}: serial ${serial}, firmware ${firmware}, ${outcome.en}.`,
    fr: `• ${host} : numéro de série ${serial}, firmware ${firmware}, ${outcome.fr}.`,
    de: `• ${host}: Seriennummer ${serial}, Firmware ${firmware}, ${outcome.de}.`,
    es: `• ${host}: número de serie ${serial}, firmware ${firmware}, ${outcome.es}.`,
  }),
  alreadyConfigured: {
    en: 'already configured',
    fr: 'déjà configurée',
    de: 'bereits konfiguriert',
    es: 'ya configurado',
  },
  newAddress: (previous) => ({
    en: `new address, replaces ${previous}`,
    fr: `nouvelle adresse, remplace ${previous}`,
    de: `neue Adresse, ersetzt ${previous}`,
    es: `nueva dirección, sustituye a ${previous}`,
  }),
  added: {
    en: 'added to the configuration',
    fr: 'ajoutée à la configuration',
    de: 'zur Konfiguration hinzugefügt',
    es: 'añadido a la configuración',
  },
  saved: {
    en: 'The chargers now appear in the Discovery tab. Reload this page before saving the configuration form, or it would put back the old addresses.',
    fr: 'Les bornes apparaissent maintenant dans l’onglet Découverte. Rechargez cette page avant d’enregistrer le formulaire de configuration, sinon il remettrait les anciennes adresses.',
    de: 'Die Ladestationen erscheinen jetzt im Tab „Entdecken“. Lade diese Seite neu, bevor du das Konfigurationsformular speicherst, sonst würde es die alten Adressen wiederherstellen.',
    es: 'Los cargadores aparecen ahora en la pestaña «Descubrir». Recargue esta página antes de guardar el formulario de configuración; si no, volvería a poner las direcciones antiguas.',
  },
  saveFailed: (value) => ({
    en: `The configuration could not be saved: type these addresses: ${value}`,
    fr: `La configuration n’a pas pu être enregistrée : saisissez ces adresses : ${value}`,
    de: `Die Konfiguration konnte nicht gespeichert werden: Trage diese Adressen ein: ${value}`,
    es: `No se ha podido guardar la configuración: introduzca estas direcciones: ${value}`,
  }),

  // --- Test action -------------------------------------------------------------
  noAddress: {
    en: 'No Wall Connector address in the configuration: type one, or use “Search for Wall Connectors”.',
    fr: 'Aucune adresse de borne dans la configuration : saisissez-en une, ou utilisez « Rechercher les bornes ».',
    de: 'Keine Wall-Connector-Adresse in der Konfiguration: Gib eine ein oder nutze „Wall Connectors suchen“.',
    es: 'No hay ninguna dirección de Wall Connector en la configuración: introduzca una o use «Buscar Wall Connectors».',
  },
  stateNumber: (state) => ({
    en: `state ${state}`,
    fr: `état ${state}`,
    de: `Zustand ${state}`,
    es: `estado ${state}`,
  }),
  testLine: (host, serial, firmware, state) => ({
    en: `${host}: Wall Connector ${serial}, firmware ${firmware}, ${state.en}.`,
    fr: `${host} : Wall Connector ${serial}, firmware ${firmware}, ${state.fr}.`,
    de: `${host}: Wall Connector ${serial}, Firmware ${firmware}, ${state.de}.`,
    es: `${host}: Wall Connector ${serial}, firmware ${firmware}, ${state.es}.`,
  }),
  noAnswer: (host, reason) => ({
    en: `${host}: no answer (${reason}).`,
    fr: `${host} : pas de réponse (${reason}).`,
    de: `${host}: keine Antwort (${reason}).`,
    es: `${host}: sin respuesta (${reason}).`,
  }),
};

// Widget texts. Tile labels hold 24 characters at most, status labels and
// values 40 (the core cuts longer ones); tiles are narrow, keep them short.
export const WIDGET_TEXTS = {
  pickDevice: {
    en: 'Choose a Wall Connector in the widget settings.',
    fr: 'Choisissez une borne dans les réglages du widget.',
    de: 'Wähle einen Wall Connector in den Einstellungen des Widgets.',
    es: 'Elija un Wall Connector en los ajustes del widget.',
  },
  notWallConnector: {
    en: 'This device is not a Tesla Wall Connector.',
    fr: "Cet appareil n'est pas une borne Tesla Wall Connector.",
    de: 'Dieses Gerät ist kein Tesla Wall Connector.',
    es: 'Este dispositivo no es un Tesla Wall Connector.',
  },
  // Tiles
  power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  current: { en: 'Current', fr: 'Courant', de: 'Strom', es: 'Corriente' },
  // At most 14 characters: 'Dernière session' is cut in a third of a line.
  thisSession: {
    en: 'This session',
    fr: 'Cette session',
    de: 'Diese Sitzung',
    es: 'Esta sesión',
  },
  lastSession: {
    en: 'Last session',
    fr: 'Session finie',
    de: 'Letzte Sitzung',
    es: 'Última sesión',
  },
  // Status rows
  total: { en: 'Total', fr: 'Total', de: 'Gesamt', es: 'Total' },
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  unreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  vehicle: { en: 'Vehicle', fr: 'Véhicule', de: 'Fahrzeug', es: 'Vehículo' },
  pluggedIn: { en: 'Plugged in', fr: 'Branché', de: 'Angeschlossen', es: 'Enchufado' },
  notPluggedIn: {
    en: 'Not plugged in',
    fr: 'Non branché',
    de: 'Nicht angeschlossen',
    es: 'No enchufado',
  },
  pluggedInFor: {
    en: 'Plugged in for',
    fr: 'Branché depuis',
    de: 'Angeschlossen seit',
    es: 'Enchufado desde hace',
  },
  chargingTime: {
    en: 'Charging time',
    fr: 'Durée de charge',
    de: 'Ladedauer',
    es: 'Tiempo de carga',
  },
};
