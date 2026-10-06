// Bruecke zwischen Oberflaeche und Programm: Portauswahl und Speichern
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spm', {
    // Liste der COM-Ports, sobald die Seite navigator.serial.requestPort() aufruft (und bei jedem Ein-/Ausstecken)
    beiPorts: (rueckruf) => ipcRenderer.on('ports', (_e, ports) => rueckruf(ports)),
    portWaehlen: (portId) => ipcRenderer.send('port-gewaehlt', portId || ''),
    csvSpeichern: (name, inhalt) => ipcRenderer.invoke('csv-speichern', name, inhalt),
    version: () => ipcRenderer.invoke('version'),
});
