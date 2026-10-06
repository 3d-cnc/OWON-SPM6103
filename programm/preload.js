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
    thema: (thema) => ipcRenderer.send('thema', thema),
    // Zusatzfunktionen: Taskleiste blinken, laufend speichern, Aufzeichnungen laden
    aufmerksamkeit: () => ipcRenderer.send('aufmerksamkeit'),
    ordnerVorgabe: () => ipcRenderer.invoke('ordner-vorgabe'),
    ordnerWaehlen: (start) => ipcRenderer.invoke('ordner-waehlen', start),
    ordnerOeffnen: (ordner) => ipcRenderer.invoke('ordner-oeffnen', ordner),
    dateiBeginnen: (ordner, name, kopf) => ipcRenderer.invoke('datei-beginnen', ordner, name, kopf),
    dateiAnhaengen: (id, text) => ipcRenderer.invoke('datei-anhaengen', id, text),
    dateiSchliessen: (id) => ipcRenderer.invoke('datei-schliessen', id),
    csvOeffnen: () => ipcRenderer.invoke('csv-oeffnen'),
    // Bilder, Messbericht, Fernanzeige
    bildSpeichern: (name, url) => ipcRenderer.invoke('bild-speichern', name, url),
    bildKopieren: (url) => ipcRenderer.invoke('bild-kopieren', url),
    berichtPdf: (name, html) => ipcRenderer.invoke('bericht-pdf', name, html),
    fernStarten: (einst) => ipcRenderer.invoke('fern-starten', einst),
    fernStoppen: () => ipcRenderer.invoke('fern-stoppen'),
    fernDaten: (daten) => ipcRenderer.send('fern-daten', daten),
    beiFernBefehl: (rueckruf) => ipcRenderer.on('fern-befehl', (_e, b) => rueckruf(b)),
});
