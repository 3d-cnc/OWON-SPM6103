// Bruecke zwischen Oberflaeche und Programm: Portauswahl, Speichern, Menue, Versionspruefung
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spm', {
    // Liste der COM-Ports, sobald die Seite navigator.serial.requestPort() aufruft (und bei jedem Ein-/Ausstecken)
    beiPorts: (rueckruf) => ipcRenderer.on('ports', (_e, ports) => rueckruf(ports)),
    portWaehlen: (portId) => ipcRenderer.send('port-gewaehlt', portId || ''),
    csvSpeichern: (name, inhalt) => ipcRenderer.invoke('csv-speichern', name, inhalt),
    version: () => ipcRenderer.invoke('version'),
    versionPruefen: () => ipcRenderer.invoke('version-pruefen'),
    einstellungen: () => ipcRenderer.invoke('einstellungen'),
    updatesBeimStart: (an) => ipcRenderer.invoke('updates-beim-start', an),
    fenstergroesse: (breite, hoehe) => ipcRenderer.invoke('fenstergroesse', breite, hoehe),
    linkOeffnen: (url) => ipcRenderer.send('link-oeffnen', url),
    beenden: () => ipcRenderer.send('beenden'),
    // Zusatzfunktionen: Taskleiste blinken, laufend speichern, Aufzeichnungen laden
    aufmerksamkeit: () => ipcRenderer.send('aufmerksamkeit'),
    ordnerVorgabe: () => ipcRenderer.invoke('ordner-vorgabe'),
    ordnerWaehlen: (start) => ipcRenderer.invoke('ordner-waehlen', start),
    ordnerOeffnen: (ordner) => ipcRenderer.invoke('ordner-oeffnen', ordner),
    dateiBeginnen: (ordner, name, kopf) => ipcRenderer.invoke('datei-beginnen', ordner, name, kopf),
    dateiAnhaengen: (id, text) => ipcRenderer.invoke('datei-anhaengen', id, text),
    dateiSchliessen: (id) => ipcRenderer.invoke('datei-schliessen', id),
    csvOeffnen: () => ipcRenderer.invoke('csv-oeffnen'),
});
