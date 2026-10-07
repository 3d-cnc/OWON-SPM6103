/*
 * OWON SPM6103 - Live-Anzeige als Windows-Programm.
 *
 * Die Oberflaeche (app/index.html) spricht ueber Web Serial mit dem Netzteil.
 * In einem normalen Browser waehlt Chrome den Port selbst aus; hier uebernimmt
 * das Programm diese Rolle: es reicht die Liste der COM-Ports an die Seite
 * weiter, die zeigt ihren eigenen Auswahldialog.
 *
 *  - Der Fensterinhalt startet in der eingestellten Groesse (Vorgabe 1920 x 1080,
 *    aenderbar im Menue, einstellungen.json); gemerkt wird die Position (fenster.json).
 *  - CSV-Dateien gehen ueber den Windows-Speicherdialog.
 *  - Beim Schliessen mit nicht gespeicherten Messdaten fragt das Programm nach.
 *  - Versionspruefung gegen die neueste Veroeffentlichung auf GitHub (Repository
 *    aus package.json); solange das Repository privat ist, meldet GitHub 404.
 *
 * `electron . --pruefen[=bild.png]` startet ohne sichtbares Fenster im
 * Demo-Modus, bedient ein paar Knoepfe, speichert ein Bild und beendet sich -
 * mit Fehlercode, wenn die Seite Fehler gemeldet hat.
 */

const { app, BrowserWindow, ClipboardItem, Menu, clipboard, dialog, ipcMain, nativeTheme, net, screen, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const paket = require('./package.json');

// Gerätetest am echten Netzteil: `electron . --geraet=COM3 [--mit-ausgang] [--pruefen=bild.png]`
// Läuft wie der Selbsttest unsichtbar und mit eigenem, leerem Benutzerordner; wählt den Port selbst.
const geraetPort = process.argv.find((a) => a.startsWith('--geraet='))?.split('=')[1]?.toUpperCase();
const mitAusgang = process.argv.includes('--mit-ausgang');
const pruefen = process.argv.find((a) => a.startsWith('--pruefen')) ?? (geraetPort ? '--pruefen' : undefined);

if (pruefen) {
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'owon-spm6103-pruefen-')));
}

let fenster = null;
let portRueckruf = null;
let portListe = [];

/* ------------------------------------------------------------ Fensterlage */

// Die Oberflaeche ist auf 1920 x 1080 ausgelegt: so gross ist der Fensterinhalt beim Start,
// solange im Menue nichts anderes eingestellt ist. Gemerkt wird ausserdem, wo das Fenster lag.
const BREITE = 1920;
const HOEHE = 1080;
const GRENZEN = { breite: [1024, 7680], hoehe: [600, 4320] };
const TITELLEISTE = 40;   // Rahmen und Titelleiste kommen zum Fensterinhalt noch dazu
const datei = (name) => path.join(app.getPath('userData'), name);

function jsonLesen(name) {
    try {
        return JSON.parse(fs.readFileSync(datei(name), 'utf8'));
    } catch {
        return {};
    }
}

function jsonSchreiben(name, wert) {
    try {
        fs.mkdirSync(app.getPath('userData'), { recursive: true });
        fs.writeFileSync(datei(name), JSON.stringify(wert, null, 2));
    } catch {
        /* nicht schlimm */
    }
}

const gueltig = (wert, [min, max]) => Number.isInteger(wert) && wert >= min && wert <= max;

let einstellungen = { breite: BREITE, hoehe: HOEHE, updatesBeimStart: true, thema: 'dunkel' };
const HINTERGRUND = { dunkel: '#0e1115', hell: '#eef1f5' };

function einstellungenLesen() {
    const e = jsonLesen('einstellungen.json');
    einstellungen = {
        breite: gueltig(e.breite, GRENZEN.breite) ? e.breite : BREITE,
        hoehe: gueltig(e.hoehe, GRENZEN.hoehe) ? e.hoehe : HOEHE,
        updatesBeimStart: e.updatesBeimStart !== false,
        thema: e.thema === 'hell' ? 'hell' : 'dunkel',
    };
    nativeTheme.themeSource = einstellungen.thema === 'hell' ? 'light' : 'dark';
}

function lageLesen() {
    const lage = jsonLesen('fenster.json');
    const { breite, hoehe } = einstellungen;
    // Bildschirm, auf dem das Fenster zuletzt lag - sonst der, auf dem die Maus steht
    const punkt = Number.isFinite(lage.x) ? { x: lage.x + 100, y: lage.y + 50 } : screen.getCursorScreenPoint();
    const b = screen.getDisplayNearestPoint(punkt).workArea;
    const passt = breite <= b.width && hoehe + TITELLEISTE <= b.height;
    // Zu kleiner Bildschirm: maximiert
    const x = Number.isFinite(lage.x) ? Math.min(Math.max(lage.x, b.x), b.x + b.width - breite) : b.x + Math.round((b.width - breite) / 2);
    const y = Number.isFinite(lage.y) ? Math.min(Math.max(lage.y, b.y), b.y + b.height - hoehe - TITELLEISTE) : b.y + Math.max(0, Math.round((b.height - hoehe - TITELLEISTE) / 2));
    return passt ? { x, y, maximiert: !!lage.maximiert } : { maximiert: true };
}

function lageSpeichern() {
    if (!fenster || pruefen) return;
    const maximiert = fenster.isMaximized();
    const { x, y } = maximiert ? fenster.getNormalBounds() : fenster.getBounds();
    jsonSchreiben('fenster.json', { x, y, maximiert });
}

/* ------------------------------------------------------------ Fenster */

function fensterOeffnen() {
    const lage = lageLesen();

    fenster = new BrowserWindow({
        x: lage.x,
        y: lage.y,
        width: einstellungen.breite,
        height: einstellungen.hoehe,
        useContentSize: true,
        minWidth: 720,
        minHeight: 520,
        show: false,
        title: 'OWON SPM6103',
        icon: path.join(__dirname, 'build', 'icon.png'),
        backgroundColor: HINTERGRUND[einstellungen.thema],
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            // Messen soll auch minimiert im vollen Takt weiterlaufen
            backgroundThrottling: false,
            // Alarmtöne auch ohne vorherigen Klick ins Fenster
            autoplayPolicy: 'no-user-gesture-required',
        },
    });
    fenster.on('focus', () => fenster.flashFrame(false));

    fenster.setMenuBarVisibility(false);
    const sitzung = fenster.webContents.session;

    // Serielle Schnittstellen ohne Rueckfrage erlauben - die Seite fragt selbst, welcher Port
    sitzung.setPermissionCheckHandler((_wc, recht) => recht === 'serial');
    sitzung.setDevicePermissionHandler((details) => details.deviceType === 'serial');

    sitzung.on('select-serial-port', (ereignis, ports, _wc, rueckruf) => {
        ereignis.preventDefault();
        // Gerätetest: den angegebenen Port ohne Dialog nehmen
        if (geraetPort) {
            const p = ports.find((x) => String(x.portName).toUpperCase() === geraetPort);
            rueckruf(p ? p.portId : '');
            return;
        }
        portAbbrechen();
        portRueckruf = rueckruf;
        portListe = ports;
        fenster.webContents.send('ports', ports);
    });
    sitzung.on('serial-port-added', (_e, port) => {
        if (!portRueckruf) return;
        portListe = [...portListe.filter((p) => p.portId !== port.portId), port];
        fenster.webContents.send('ports', portListe);
    });
    sitzung.on('serial-port-removed', (_e, port) => {
        if (!portRueckruf) return;
        portListe = portListe.filter((p) => p.portId !== port.portId);
        fenster.webContents.send('ports', portListe);
    });

    // Messdaten nicht gespeichert: die Seite haelt das Schliessen an, hier wird gefragt
    fenster.webContents.on('will-prevent-unload', (ereignis) => {
        if (pruefen) {
            ereignis.preventDefault();
            return;
        }
        const wahl = dialog.showMessageBoxSync(fenster, {
            type: 'question',
            buttons: ['Beenden', 'Abbrechen'],
            defaultId: 1,
            cancelId: 1,
            title: 'OWON SPM6103',
            message: 'Die Messdaten sind noch nicht als CSV gespeichert.',
            detail: 'Trotzdem beenden? Die Aufzeichnung geht dann verloren.',
        });
        if (wahl === 0) ereignis.preventDefault();
    });

    // Links (z. B. in der Anleitung) im normalen Browser oeffnen, nie im Programmfenster
    fenster.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    fenster.webContents.on('will-navigate', (ereignis) => ereignis.preventDefault());

    fenster.once('ready-to-show', () => {
        if (pruefen) {
            // Selbsttest: ganz durchsichtig, aber wirklich gezeigt - ein verstecktes Fenster zeichnet nicht alles neu
            fenster.setOpacity(0);
            fenster.setSkipTaskbar(true);
            fenster.showInactive();
            return;
        }
        if (lage.maximiert) fenster.maximize();
        fenster.show();
    });
    fenster.on('close', lageSpeichern);
    fenster.on('closed', () => { fenster = null; });

    fenster.loadFile(path.join(__dirname, 'app', 'index.html'));
}

function portAbbrechen() {
    if (portRueckruf) {
        portRueckruf('');
        portRueckruf = null;
    }
}

ipcMain.on('port-gewaehlt', (_e, portId) => {
    if (!portRueckruf) return;
    const rueckruf = portRueckruf;
    portRueckruf = null;
    rueckruf(portListe.some((p) => p.portId === portId) ? portId : '');
});

ipcMain.handle('csv-speichern', async (_e, name, inhalt) => {
    const { canceled, filePath } = await dialog.showSaveDialog(fenster, {
        title: 'Messdaten speichern',
        defaultPath: path.join(app.getPath('documents'), name),
        filters: [{ name: 'CSV-Datei', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return null;
    fs.writeFileSync(filePath, inhalt, 'utf8');
    return filePath;
});

ipcMain.handle('version', () => app.getVersion());

/* ------------------------------------------------------------ Menue: Einstellungen, Fenstergroesse, Beenden */

ipcMain.handle('einstellungen', () => {
    const b = screen.getDisplayMatching(fenster.getBounds()).workArea;
    const [breite, hoehe] = fenster.getContentSize();
    return {
        ...einstellungen,
        vorgabe: { breite: BREITE, hoehe: HOEHE },
        grenzen: GRENZEN,
        jetzt: { breite, hoehe },
        // So gross kann der Fensterinhalt auf diesem Bildschirm hoechstens werden
        bildschirm: { breite: b.width, hoehe: b.height - TITELLEISTE },
    };
});

ipcMain.handle('updates-beim-start', (_e, an) => {
    einstellungen.updatesBeimStart = !!an;
    jsonSchreiben('einstellungen.json', einstellungen);
    return einstellungen.updatesBeimStart;
});

// Neue Startgroesse speichern und gleich anwenden; passt sie nicht auf den Bildschirm, wird verkleinert
ipcMain.handle('fenstergroesse', (_e, breite, hoehe) => {
    if (!gueltig(breite, GRENZEN.breite) || !gueltig(hoehe, GRENZEN.hoehe)) {
        return { ok: false, grund: `Erlaubt sind ${GRENZEN.breite.join('–')} × ${GRENZEN.hoehe.join('–')} Pixel.` };
    }
    einstellungen.breite = breite;
    einstellungen.hoehe = hoehe;
    jsonSchreiben('einstellungen.json', einstellungen);

    const b = screen.getDisplayMatching(fenster.getBounds()).workArea;
    const w = Math.min(breite, b.width);
    const h = Math.min(hoehe, b.height - TITELLEISTE);
    if (fenster.isFullScreen()) fenster.setFullScreen(false);
    if (fenster.isMaximized()) fenster.unmaximize();
    fenster.setContentSize(w, h);
    // Ragt das Fenster jetzt ueber den Bildschirmrand, zurueck auf den Bildschirm schieben
    const r = fenster.getBounds();
    fenster.setPosition(Math.min(Math.max(r.x, b.x), b.x + b.width - r.width), Math.min(Math.max(r.y, b.y), b.y + b.height - r.height));
    return { ok: true, breite, hoehe, angewendet: { breite: w, hoehe: h }, verkleinert: w < breite || h < hoehe };
});

ipcMain.on('beenden', () => fenster?.close());

// Hell/Dunkel: Fensterhintergrund und Windows-Dialoge mitziehen, für den nächsten Start merken
ipcMain.on('thema', (_e, thema) => {
    thema = thema === 'hell' ? 'hell' : 'dunkel';
    nativeTheme.themeSource = thema === 'hell' ? 'light' : 'dark';
    fenster?.setBackgroundColor(HINTERGRUND[thema]);
    if (einstellungen.thema !== thema) {
        einstellungen.thema = thema;
        jsonSchreiben('einstellungen.json', einstellungen);
    }
});   // fragt nach, wenn Messdaten ungespeichert sind

/* ------------------------------------------------------------ Zusatzfunktionen: Taskleiste, Dateien */

// Alarm, Abschaltung, Akku fertig: Taskleiste blinken lassen, bis das Fenster wieder vorn ist
ipcMain.on('aufmerksamkeit', () => { if (fenster && !fenster.isFocused()) fenster.flashFrame(true); });

// Laufend speichern: Vorgabe-Ordner, im Selbsttest ein eigener im Temp-Ordner
const vorgabeOrdner = () => pruefen ? datei('aufzeichnungen') : path.join(app.getPath('documents'), 'OWON SPM6103');
ipcMain.handle('ordner-vorgabe', () => vorgabeOrdner());
ipcMain.handle('ordner-waehlen', async (_e, start) => {
    const r = await dialog.showOpenDialog(fenster, {
        title: 'Ordner für laufend gespeicherte Aufzeichnungen',
        defaultPath: start || vorgabeOrdner(),
        properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('ordner-oeffnen', (_e, ordner) => {
    try {
        fs.mkdirSync(ordner, { recursive: true });
        if (fs.statSync(ordner).isDirectory()) return shell.openPath(ordner);
    } catch {
        /* Ordner gibt es nicht */
    }
    return 'nicht gefunden';
});

// Offene Dateien des laufenden Speicherns; die Seite kennt nur die Nummer
const offeneDateien = new Map();
let naechsteDatei = 1;
ipcMain.handle('datei-beginnen', (_e, ordner, name, kopf) => {
    const sauber = path.basename(String(name)).replace(/[^\w.\-äöüÄÖÜß ]/g, '_');
    if (!/\.csv$/i.test(sauber)) throw new Error('nur CSV-Dateien');
    fs.mkdirSync(ordner, { recursive: true });
    const pfad = path.join(ordner, sauber);
    fs.writeFileSync(pfad, '﻿' + kopf + '\r\n', 'utf8');
    const id = naechsteDatei++;
    offeneDateien.set(id, pfad);
    return { id, pfad };
});
ipcMain.handle('datei-anhaengen', (_e, id, text) => {
    const pfad = offeneDateien.get(id);
    if (!pfad) return false;
    fs.appendFileSync(pfad, text, 'utf8');
    return true;
});
ipcMain.handle('datei-schliessen', (_e, id) => offeneDateien.delete(id));

/* ------------------------------------------------------------ Bilder und Messbericht (SPM-25, SPM-26) */

// Speichern: Dialog (im Selbsttest ohne Dialog in den Temp-Ordner); liefert den Pfad oder null
async function speicherOrt(name, titel, filter) {
    if (pruefen) return datei(path.basename(name));
    const { canceled, filePath } = await dialog.showSaveDialog(fenster, { title: titel, defaultPath: path.join(app.getPath('documents'), name), filters: [filter] });
    return canceled ? null : filePath;
}
const pngAusDataUrl = (url) => Buffer.from(String(url).replace(/^data:image\/png;base64,/, ''), 'base64');

ipcMain.handle('bild-speichern', async (_e, name, url) => {
    const pfad = await speicherOrt(name, 'Bild speichern', { name: 'PNG-Bild', extensions: ['png'] });
    if (!pfad) return null;
    fs.writeFileSync(pfad, pngAusDataUrl(url));
    return pfad;
});
// Electron 44: Zwischenablage nach dem W3C-Muster (ClipboardItem mit Blob)
ipcMain.handle('bild-kopieren', async (_e, url) => {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([pngAusDataUrl(url)], { type: 'image/png' }) })]);
    return true;
});

// Messbericht: HTML in ein unsichtbares Fenster laden, mit Chromium zu PDF drucken, speichern, öffnen
ipcMain.handle('bericht-pdf', async (_e, name, html) => {
    const temp = path.join(os.tmpdir(), `owon-spm6103-bericht-${process.pid}-${Date.now()}.html`);
    fs.writeFileSync(temp, html, 'utf8');
    if (pruefen) fs.writeFileSync(datei('bericht.html'), html, 'utf8');   // der Selbsttest fotografiert die Seite
    const druck = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    try {
        await druck.loadFile(temp);
        const pdf = await druck.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'none' } });
        const pfad = await speicherOrt(name, 'Messbericht speichern', { name: 'PDF-Datei', extensions: ['pdf'] });
        if (!pfad) return null;
        fs.writeFileSync(pfad, pdf);
        if (!pruefen) shell.openPath(pfad);
        return pfad;
    } finally {
        druck.destroy();
        fs.rmSync(temp, { force: true });
    }
});

/* ------------------------------------------------------------ Fernanzeige im WLAN (SPM-27) */

// Kleiner Webserver im eigenen Netz: Handy-Seite, /daten (JSON), /aus (nur wenn erlaubt). Alles nur mit Code.
const fern = { server: null, code: '', notaus: false, daten: null, versuche: new Map(), port: 0 };
const FERN_SEITE = path.join(__dirname, 'fern', 'index.html');

function codeStimmt(gegeben) {
    const a = Buffer.from(String(gegeben ?? '')), b = Buffer.from(fern.code);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Höchstens 10 falsche Codes je Adresse und Minute
function gesperrt(ip) {
    const v = fern.versuche.get(ip);
    return v && v.anzahl >= 10 && Date.now() - v.seit < 60000;
}
function fehlversuch(ip) {
    const v = fern.versuche.get(ip);
    if (!v || Date.now() - v.seit > 60000) fern.versuche.set(ip, { anzahl: 1, seit: Date.now() });
    else v.anzahl++;
}

function fernAntwort(anfrage, antwort) {
    const url = new URL(anfrage.url, 'http://x');
    const ip = anfrage.socket.remoteAddress;
    const cookie = /(?:^|;\s*)spmcode=(\d+)/.exec(anfrage.headers.cookie ?? '')?.[1];
    const code = url.searchParams.get('code') ?? anfrage.headers['x-code'] ?? cookie;
    const kopf = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (gesperrt(ip)) { antwort.writeHead(429, kopf); return antwort.end('Zu viele falsche Codes'); }
    const ok = code !== undefined && codeStimmt(code);
    if (code !== undefined && !ok) fehlversuch(ip);

    if (anfrage.method === 'GET' && url.pathname === '/') {
        // Die Seite selbst fragt nach dem Code, wenn er fehlt; mit richtigem Code merkt sie ihn als Cookie
        if (ok) kopf['Set-Cookie'] = `spmcode=${fern.code}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`;
        antwort.writeHead(200, { ...kopf, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
        return antwort.end(fs.readFileSync(FERN_SEITE));
    }
    if (!ok) { antwort.writeHead(401, kopf); return antwort.end('Zugangscode fehlt oder ist falsch'); }
    if (anfrage.method === 'GET' && url.pathname === '/daten') {
        antwort.writeHead(200, { ...kopf, 'Content-Type': 'application/json; charset=utf-8' });
        return antwort.end(JSON.stringify({ ...(fern.daten ?? { t: 0 }), notaus: fern.notaus }));
    }
    if (anfrage.method === 'POST' && url.pathname === '/aus') {
        if (!fern.notaus) { antwort.writeHead(403, kopf); return antwort.end('Im Programm nicht erlaubt'); }
        fenster?.webContents.send('fern-befehl', 'aus');
        antwort.writeHead(200, kopf);
        return antwort.end('ok');
    }
    antwort.writeHead(404, kopf);
    antwort.end();
}

// Adressen im lokalen Netz (192.168…, 10…, 172.16–31…), daraus die Links fürs Handy
function lokaleAdressen(port) {
    const privat = (a) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
    return Object.values(os.networkInterfaces()).flat()
        .filter((n) => n && n.family === 'IPv4' && !n.internal && privat(n.address))
        .map((n) => `http://${n.address}:${port}/?code=${fern.code}`);
}

ipcMain.handle('fern-starten', async (_e, { port, code, notaus, nurEinstellungen }) => {
    fern.notaus = !!notaus;
    if (nurEinstellungen) return { ok: true };
    if (!/^\d{6}$/.test(String(code))) return { ok: false, fehler: 'ungültiger Code' };
    fern.code = String(code);
    if (fern.server) { fern.server.close(); fern.server = null; }
    const server = http.createServer(fernAntwort);
    try {
        await new Promise((ok, fehler) => { server.once('error', fehler); server.listen(port, '0.0.0.0', ok); });
    } catch (e) {
        return { ok: false, fehler: e.code ?? e.message };
    }
    fern.server = server; fern.port = server.address().port;
    const adressen = lokaleAdressen(fern.port);
    let qr = null;
    try { if (adressen[0]) qr = await require('qrcode').toDataURL(adressen[0], { margin: 1, width: 440 }); } catch { /* ohne QR-Code geht es auch */ }
    return { ok: true, adressen, qr, port: fern.port };
});
ipcMain.handle('fern-stoppen', () => { fern.server?.close(); fern.server = null; return true; });
ipcMain.on('fern-daten', (_e, daten) => { fern.daten = daten; });
app.on('before-quit', () => fern.server?.close());

// Vergleich: CSV-Dateien auswählen und lesen (im Selbsttest: alle aus dem Prüf-Ordner)
ipcMain.handle('csv-oeffnen', async () => {
    let pfade;
    if (pruefen) {
        const ordner = vorgabeOrdner();
        pfade = fs.existsSync(ordner) ? fs.readdirSync(ordner).filter((n) => n.endsWith('.csv')).map((n) => path.join(ordner, n)) : [];
    } else {
        const r = await dialog.showOpenDialog(fenster, {
            title: 'Aufzeichnungen zum Vergleich laden',
            defaultPath: vorgabeOrdner(),
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'CSV-Datei', extensions: ['csv'] }],
        });
        pfade = r.canceled ? [] : r.filePaths;
    }
    return pfade.slice(0, 6).map((p) => ({ name: path.basename(p), text: fs.readFileSync(p, 'utf8') }));
});

/* ------------------------------------------------------------ Versionspruefung */

// "https://github.com/3d-cnc/OWON-SPM6103" -> "3d-cnc/OWON-SPM6103"
const REPO = String(paket.repository?.url ?? paket.repository ?? '').replace(/^(git\+)?https:\/\/github\.com\/|^github:|\.git$/g, '');

// 1.10.0 > 1.9.3; ein Zusatz wie -beta zaehlt als aelter als die Version ohne
function versionVergleich(a, b) {
    const teile = (v) => String(v).trim().replace(/^v/i, '').split('-');
    const [ka, za] = teile(a), [kb, zb] = teile(b);
    const na = ka.split('.').map(Number), nb = kb.split('.').map(Number);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
        const d = (na[i] || 0) - (nb[i] || 0);
        if (d) return Math.sign(d);
    }
    if (za && !zb) return -1;
    if (!za && zb) return 1;
    return 0;
}

async function versionPruefen() {
    const installiert = app.getVersion();
    const seite = `https://github.com/${REPO}/releases`;
    const ergebnis = (status, mehr = {}) => ({ status, installiert, seite, geprueft: Date.now(), ...mehr });
    let antwort;
    try {
        antwort = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': `OWON-SPM6103/${installiert}` },
            signal: AbortSignal.timeout(10000),
        });
    } catch {
        return ergebnis('unbekannt', { grund: 'Keine Verbindung zu GitHub. Später noch einmal versuchen.' });
    }
    if (antwort.status === 404) {
        return ergebnis('unbekannt', { grund: 'GitHub kennt keine öffentliche Version. Solange das Projekt privat ist, kann das Programm nicht nachsehen.' });
    }
    if (antwort.status === 403 || antwort.status === 429) {
        return ergebnis('unbekannt', { grund: 'GitHub nimmt gerade keine Anfragen an (zu viele in kurzer Zeit). In einer Stunde noch einmal versuchen.' });
    }
    if (!antwort.ok) return ergebnis('unbekannt', { grund: `GitHub antwortet mit Fehler ${antwort.status}.` });

    const r = await antwort.json();
    const neueste = String(r.tag_name || '').replace(/^v/i, '');
    if (!neueste) return ergebnis('unbekannt', { grund: 'GitHub nennt keine Versionsnummer.' });
    const neuer = versionVergleich(neueste, installiert) > 0;
    return ergebnis(neuer ? 'neu' : 'aktuell', {
        neueste,
        datum: r.published_at,
        notizen: String(r.body || '').slice(0, 4000),
        seite: r.html_url || seite,
        download: (r.assets || []).find((a) => /\.exe$/i.test(a.name))?.browser_download_url ?? null,
    });
}

ipcMain.handle('version-pruefen', () => versionPruefen());

// Nur Links ins eigene GitHub-Projekt oeffnen - im normalen Browser, nie im Programmfenster
// Ohne Adresse: die Seite mit allen Versionen
ipcMain.on('link-oeffnen', (_e, url) => {
    if (!url) url = `https://github.com/${REPO}/releases`;
    if (typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/`)) shell.openExternal(url);
});

/* ------------------------------------------------------------ Start */

if (!pruefen && !app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (fenster) {
            if (fenster.isMinimized()) fenster.restore();
            fenster.focus();
        }
    });

    app.whenReady().then(() => {
        // Kein Menue - nur F12 fuer die Entwicklerwerkzeuge, Strg+R zum Neuladen, F11 Vollbild
        Menu.setApplicationMenu(Menu.buildFromTemplate([{
            label: 'Ansicht',
            visible: false,
            submenu: [
                { role: 'toggleDevTools', accelerator: 'F12' },
                { role: 'reload', accelerator: 'CmdOrCtrl+R' },
                { role: 'togglefullscreen', accelerator: 'F11' },
                { role: 'zoomIn', accelerator: 'CmdOrCtrl+Plus' },
                { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
                { role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
            ],
        }]));
        einstellungenLesen();
        fensterOeffnen();
        if (geraetPort) geraetLaufen();
        else if (pruefen) pruefenLaufen();
    });

    app.on('window-all-closed', () => app.quit());
}

/* ------------------------------------------------------------ Selbsttest */

function pruefenLaufen() {
    const fehler = [];
    const bildDatei = pruefen.includes('=') ? pruefen.split('=')[1] : path.join(os.tmpdir(), 'owon-spm6103-pruefen.png');
    const js = (code) => fenster.webContents.executeJavaScript(code);
    const warten = (ms) => new Promise((weiter) => setTimeout(weiter, ms));
    // Ein unsichtbares Fenster zeichnet selten neu - vor jedem Bild einmal anstossen
    const frischesBild = async () => { fenster.webContents.invalidate(); await warten(400); return fenster.webContents.capturePage(); };

    fenster.webContents.on('console-message', (ereignis) => {
        if (ereignis.level === 'error') fehler.push(ereignis.message);
    });
    fenster.webContents.on('render-process-gone', (_e, grund) => fehler.push('Seite abgestuerzt: ' + grund.reason));
    fenster.webContents.on('did-fail-load', (_e, code, text) => fehler.push(`Laden fehlgeschlagen: ${code} ${text}`));

    fenster.webContents.once('did-finish-load', async () => {
        try {
            const schnittstelle = await js("({ serial: 'serial' in navigator, bruecke: typeof window.spm })");
            // Portauswahl: geht der eigene Dialog auf, und bricht Abbrechen die Anfrage sauber ab?
            // Ein echter Mausklick auf „Verbinden“ - requestPort() verlangt eine Nutzergeste
            const knopf = await js("(() => { const r = document.getElementById('verbinden').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
            fenster.webContents.sendInputEvent({ type: 'mouseDown', x: knopf.x, y: knopf.y, button: 'left', clickCount: 1 });
            fenster.webContents.sendInputEvent({ type: 'mouseUp', x: knopf.x, y: knopf.y, button: 'left', clickCount: 1 });
            await warten(1500);
            const portwahl = await js("({ offen: document.getElementById('portwahl').open, text: document.getElementById('portliste').innerText.trim().slice(0, 120) })");
            await js("document.getElementById('port-abbrechen').click()");
            await warten(500);
            portwahl.ergebnis = await js("document.getElementById('status-text').textContent + ' / ' + document.getElementById('verbinden').textContent");
            await js("document.getElementById('demo').click()");
            await warten(1000);
            await js("document.getElementById('ausgang').click()");
            await warten(2500);
            await js("(() => { const e = document.getElementById('e-curr'); e.value = '0,8'; e.nextElementSibling.click(); })()");
            await js("document.querySelector('#funktionen button[data-f=\"RES\"]').click()");
            await warten(4000);
            const werte = await js(`({
                u: document.getElementById('u').textContent, i: document.getElementById('i').textContent,
                modus: document.getElementById('m-modus').textContent,
                dmm: document.getElementById('dmm').textContent + ' ' + document.getElementById('dmm-einheit').textContent,
                punkte: zustand.live.length, vorStart: zustand.daten.length, meldung: document.getElementById('meldung').textContent })`);
            // Auf 1920 x 1080 muss die Live-Seite ohne Scrollen passen
            const flaeche = await js(`(() => { const m = document.querySelector('main');
                return { fenster: innerWidth + ' x ' + innerHeight, scrollt: m.scrollHeight > m.clientHeight + 1 || m.scrollWidth > m.clientWidth + 1,
                         kurve: document.querySelector('#diagramme canvas').clientHeight }; })()`);
            // Viele Konsolen-Einträge dürfen den Verlauf nicht zusammendrücken: die Konsole füllt ihr Feld bis zur Eingabe, der Rest scrollt
            const konsole = await js(`(() => {
                for (let n = 1; n <= 40; n++) log('Testeintrag ' + n + ' ' + 'mit langem Text '.repeat(n % 3 ? 1 : 12), n % 2 ? 'aus' : 'ein');
                const el = document.getElementById('konsole-log'), zeile = el.lastElementChild.getBoundingClientRect().height;
                const innen = el.clientHeight - parseFloat(getComputedStyle(el).paddingTop) - parseFloat(getComputedStyle(el).paddingBottom);
                const luecke = document.querySelector('.konsole-eingabe').getBoundingClientRect().top - el.getBoundingClientRect().bottom;
                return { eintraege: el.childElementCount, luecke: Math.round(luecke), sichtbar: Math.round(innen / zeile * 10) / 10, scrollbar: el.scrollHeight > el.clientHeight, amEnde: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
                         kurveNachher: document.querySelector('#diagramme canvas').clientHeight }; })()`);
            flaeche.konsole = konsole;
            fs.writeFileSync(bildDatei, (await frischesBild()).toPNG());

            // Ein einzelnes „ERR“ des Geräts fängt die zweite Abfrage ab; erst zwei hintereinander landen im Log
            const aussetzer = () => js("[...document.querySelectorAll('#konsole-log div')].filter(z => z.textContent.includes('Aussetzer')).length");
            const errVorher = await aussetzer();
            await js('zustand.geraet.errNoch = 1'); await warten(1500);
            const errEinmal = await aussetzer() - errVorher;
            await js('zustand.geraet.errNoch = 2'); await warten(1500);
            werte.err = { einmal: errEinmal, zweimal: await aussetzer() - errVorher - errEinmal, rest: await js('zustand.geraet.errNoch') };

            // Tab 2: Aufzeichnung - läuft erst nach „Starten“
            await js("document.querySelector('.tab[data-seite=\"seite-aufz\"]').click()");
            await js("document.getElementById('aufz-start').click()");
            await warten(3000);
            const aufz = await js(`({ status: document.getElementById('aufz-status').textContent, zeilen: document.querySelectorAll('#tabelle-zeilen .tz').length, anzahl: document.getElementById('anzahl').textContent,
                kennwerte: document.querySelectorAll('#kennwerte tr').length, energie: document.getElementById('energie').textContent,
                zaehler: document.getElementById('tab-zaehler').textContent,
                scrollt: document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight + 1 })`);
            const bildName = (zusatz) => bildDatei.replace(/\.png$/i, '') + '-' + zusatz + '.png';
            fs.writeFileSync(bildName('aufzeichnung'), (await frischesBild()).toPNG());
            // Beenden hält die Aufzeichnung an, Starten setzt sie fort
            await js("document.getElementById('aufz-stopp').click()");
            await warten(600);
            const nachStopp = await js('zustand.daten.length');
            await warten(1200);
            aufz.stopp = { gleich: await js('zustand.daten.length') === nachStopp, status: await js("document.getElementById('aufz-status').textContent"),
                start: await js("!document.getElementById('aufz-start').disabled"), liveWeiter: await js('zustand.live.length') > werte.punkte };
            await js("document.getElementById('aufz-start').click()");
            await warten(1200);
            aufz.weiter = await js('zustand.daten.length') > nachStopp;
            await js("document.querySelector('.tab[data-seite=\"seite-live\"]').click()");

            /* ---------- Zusatzfunktionen SPM-10 bis SPM-19 ---------- */
            const bisWahr = async (ausdruck, ms) => { for (let n = 0; n < ms / 250; n++) { if (await js(ausdruck)) return true; await warten(250); } return false; };
            const jaImDialog = async () => { await warten(300); await js("document.querySelector('#frage-dialog [data-a=ja]').click()"); };
            const zusatz = {};

            // SPM-16 Laufend speichern: eine Datei für die ganze Sitzung
            await js("document.getElementById('ls-an').click()");
            await warten(1500);

            // SPM-10 Vorlage „12 V“ bei eingeschaltetem Ausgang: erst Rückfrage, dann 12 V / 2 A mit passenden Grenzen
            await js("[...document.querySelectorAll('#vorlagen .vorlage')].find(k => k.textContent.startsWith('12 V')).click()");
            zusatz.vorlageFragt = await bisWahr("document.getElementById('frage-dialog').open", 2000);
            await jaImDialog();
            await warten(1500);
            zusatz.vorlage = await js('zustand.soll');

            // SPM-17 Markierung über die Taste M
            await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))");
            await warten(300);
            await js("document.querySelector('#frage-dialog input').value = 'Testmarke'");
            await jaImDialog();
            await warten(800);
            zusatz.markierung = await js("({ ereignis: zustand.ereignisse.some(e => e.text === 'Testmarke'), inDaten: zustand.daten.some(r => r.notiz === 'Testmarke') })");

            // SPM-12 Alarm „Strom über 0,5 A“ mit Abschalten
            await js(`alRegeln.splice(0, alRegeln.length, { an: true, groesse: 'i', vergleich: 'ueber', wert: '500m', aktion: 'aus' }); alZeichnen();
                document.getElementById('al-aktiv').click()`);
            zusatz.alarm = await bisWahr("document.getElementById('alarm-leiste').classList.contains('sichtbar') && zustand.ausgang === false", 5000);
            await js("document.getElementById('alarm-quittieren').click(); document.getElementById('al-aktiv').click()");

            // SPM-11 Abschalten nach 3 s Ausgangszeit
            await js(`for (const [id, w] of [['ab-zeit-an', true], ['ab-wh-an', false], ['ab-ah-an', false], ['ab-unter-an', false]]) document.getElementById(id).checked = w;
                document.getElementById('ab-h').value = '0'; document.getElementById('ab-min').value = '0'; document.getElementById('ab-s').value = '3';
                ausgangSchalten(true).then(() => document.getElementById('ab-start').click())`);
            zusatz.abschalten = await bisWahr("document.getElementById('ab-status').textContent === 'abgeschaltet' && zustand.ausgang === false", 9000);

            // SPM-13 Ablaufprogramm: 3 V, dann Rampe auf 6 V, je 2 s
            await js(`apProgramm = { schritte: [{ volt: 3, curr: 1, dauer: 2, rampe: false }, { volt: 6, curr: 1, dauer: 2, rampe: true }], wdh: 1, ende: 'aus' }; apZeichnen();
                document.getElementById('ap-start').click()`);
            zusatz.ablaufLaeuft = await bisWahr("document.getElementById('ap-status').textContent === 'läuft'", 2000);
            zusatz.ablauf = await bisWahr("document.getElementById('ap-status').textContent === 'fertig'", 10000);
            zusatz.ablaufEnde = await js('({ volt: zustand.soll.volt, ausgang: zustand.ausgang })');

            // SPM-15 Kennlinie an der Demo-LED: bricht ab, sobald 20 mA erreicht sind
            await js(`document.getElementById('demo-last').value = 'led'; document.getElementById('demo-last').dispatchEvent(new Event('change'));
                for (const [id, w] of [['kl-name', 'LED Test'], ['kl-von', '0'], ['kl-bis', '3'], ['kl-schritt', '0,1'], ['kl-strom', '0,02'], ['kl-warten', '200']]) document.getElementById(id).value = w;
                document.querySelector('.tab[data-seite="seite-kennlinie"]').click(); document.getElementById('kl-messen').click()`);
            await bisWahr("kl.laeuft", 2000);
            await bisWahr("!kl.laeuft", 40000);
            zusatz.kennlinie = await js("(() => { const k = klKurven.at(-1); const p = k.punkte.at(-1); return { punkte: k.punkte.length, letzterModus: p.modus, strom: p.i, status: document.getElementById('kl-status').textContent }; })()");
            fs.writeFileSync(bildName('kennlinie'), (await frischesBild()).toPNG());

            // SPM-14 Akku laden am Demo-Akku (Li-Ion, 5 mAh, halb leer); „voll“ schon nach 2 s unter dem Abschaltstrom
            await js(`document.getElementById('demo-last').value = 'akku'; document.getElementById('demo-last').dispatchEvent(new Event('change')); zustand.geraet.akkuSoc = 0.3; AK_BESTAETIGUNG.s = 2;
                for (const [id, w] of [['ak-typ', 'liion'], ['ak-zellen', '1'], ['ak-kap', '2000'], ['ak-strom', '1'], ['ak-schluss', '4,2'], ['ak-ende', '0,05'], ['ak-limit', '1']]) document.getElementById(id).value = w;
                document.querySelector('.tab[data-seite="seite-auto"]').click(); document.getElementById('ak-start').click()`);
            await jaImDialog();
            await bisWahr("ak.laeuft", 3000);
            await warten(6000);
            fs.writeFileSync(bildName('automatik'), (await frischesBild()).toPNG());
            // erst fertig, wenn auch das Ergebnis dasteht – akEnde schaltet zwischendurch noch den Ausgang aus
            await bisWahr("!ak.laeuft && document.getElementById('ak-status').textContent !== 'lädt'", 60000);
            zusatz.akku = await js("({ status: document.getElementById('ak-status').textContent, mah: Math.round(ak.ladung / 3.6 * 100) / 100, ausgang: zustand.ausgang, info: document.getElementById('ak-info').textContent })");

            // SPM-19 Bauteilprüfung: das Demo-Multimeter wechselt alle 5,5 s das Bauteil
            await js(`document.getElementById('bt-funktion').value = 'RES'; document.getElementById('bt-art').value = 'toleranz';
                document.getElementById('bt-soll').value = '4,7k'; document.getElementById('bt-tol').value = '5'; document.getElementById('bt-tol').dispatchEvent(new Event('change'));
                document.querySelector('.tab[data-seite="seite-bauteile"]').click()`);
            await bisWahr('bt.gut + bt.schlecht >= 2', 16000);
            zusatz.bauteile = await js('({ gut: bt.gut, schlecht: bt.schlecht, protokoll: bt.protokoll.map(p => Math.round(p.v) + (p.gut ? " gut" : " schlecht")) })');
            fs.writeFileSync(bildName('bauteile'), (await frischesBild()).toPNG());

            // SPM-16 Datei prüfen: angelegt, mit Zeilen und der Markierung
            await warten(1200);
            const lsOrdner = datei('aufzeichnungen');
            const lsDateien = fs.existsSync(lsOrdner) ? fs.readdirSync(lsOrdner) : [];
            const lsText = lsDateien.length ? fs.readFileSync(path.join(lsOrdner, lsDateien[0]), 'utf8') : '';
            zusatz.laufend = { dateien: lsDateien.length, zeilen: lsText.split('\r\n').filter(Boolean).length - 1, markierung: lsText.includes('Testmarke'), kopf: lsText.startsWith('﻿Zeit;Sekunden') };

            // SPM-18 Vergleich: die laufend gespeicherte Datei laden und die aktuelle Aufzeichnung dazu
            await js("document.querySelector('.tab[data-seite=\"seite-vergleich\"]').click(); document.getElementById('vg-laden').click()");
            await warten(800);
            await js("document.getElementById('vg-aktuell').click()");
            await warten(500);
            zusatz.vergleich = await js('({ reihen: vg.reihen.length, punkte: vg.reihen.map(r => r.punkte.length) })');
            fs.writeFileSync(bildName('vergleich'), (await frischesBild()).toPNG());
            await js("document.querySelector('.tab[data-seite=\"seite-aufz\"]').click()");
            await warten(500);
            fs.writeFileSync(bildName('aufzeichnung2'), (await frischesBild()).toPNG());
            await js("document.querySelector('.tab[data-seite=\"seite-live\"]').click()");
            await warten(300);
            zusatz.liveScrollt = await js("document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight + 1");
            fs.writeFileSync(bildName('live2'), (await frischesBild()).toPNG());

            /* ---------- SPM-22 bis SPM-27 ---------- */
            const neu = {};
            await js("document.querySelector('.tab[data-seite=\"seite-live\"]').click(); document.getElementById('demo-last').value = 'widerstand'; document.getElementById('demo-last').dispatchEvent(new Event('change'))");

            // SPM-22 Feinverstellung: dreimal Mausrad = +30 mV, mit Umschalt +100 mV; nie über OVP
            await js("sollwerteSetzen({ volt: 5, curr: 1, ovp: 10, ocp: 2 })");
            await warten(800);
            const rad = (auswahl, extra = '') => js(`document.querySelector('${auswahl}').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true${extra} }))`);
            for (let n = 0; n < 3; n++) await rad('.sollwert');
            await rad('.sollwert', ', shiftKey: true');
            await warten(1200);
            neu.fein = await js('zustand.soll.volt');
            await js("sollwerteSetzen({ ovp: 5.2 })");
            await warten(600);
            await rad('.sollwert', ', ctrlKey: true');
            await warten(1200);
            neu.feinGrenze = await js('zustand.soll.volt');

            // SPM-23 Erst-Einschalten: an der LED bis 1,5 V fließt kein Strom → in Ordnung; am Widerstand bis 5 V → Abbruch
            await js(`document.querySelector('.tab[data-seite="seite-pruefstand"]').click();
                document.getElementById('demo-last').value = 'led'; document.getElementById('demo-last').dispatchEvent(new Event('change'));
                for (const [id, w] of [['ee-name', 'Testplatine'], ['ee-ziel', '1,5'], ['ee-strom', '0,1'], ['ee-rampe', '1,5'], ['ee-grenze', '0,05'], ['ee-halten', '1']]) document.getElementById(id).value = w;
                document.getElementById('ee-start').click()`);
            await bisWahr('ee.laeuft', 3000);
            await bisWahr('!ee.laeuft', 20000);
            neu.ersteinGut = await js('({ ...ee.protokoll.at(-1), ausgang: zustand.ausgang })');
            await js(`document.getElementById('demo-last').value = 'widerstand'; document.getElementById('demo-last').dispatchEvent(new Event('change'));
                document.getElementById('ee-ziel').value = '5'; document.getElementById('ee-rampe').value = '3'; document.getElementById('ee-start').click()`);
            await bisWahr('ee.laeuft', 3000);
            await bisWahr('!ee.laeuft', 20000);
            neu.ersteinSchlecht = await js('({ ...ee.protokoll.at(-1), ausgang: zustand.ausgang })');

            // SPM-24 Zyklentest: 3 Zyklen im Fenster 0,1–2 A in Ordnung; dann Fenster bis 0,2 A → Fehler im 1. Zyklus, Halt
            await js(`for (const [id, w] of [['zt-volt', '5'], ['zt-curr', '1'], ['zt-an', '1,5'], ['zt-aus', '0,5'], ['zt-zyklen', '3'], ['zt-einschwing', '0,3'], ['zt-min', '0,1'], ['zt-max', '2'], ['zt-fehler', 'halt']]) document.getElementById(id).value = w;
                document.getElementById('zt-start').click()`);
            await bisWahr('zt.laeuft', 3000);
            await bisWahr('!zt.laeuft', 25000);
            neu.zyklenGut = await js('({ ok: zt.ok, fehler: zt.fehler, status: document.getElementById("zt-status").textContent })');
            await js("document.getElementById('zt-max').value = '0,2'; document.getElementById('zt-start').click()");
            await bisWahr('zt.laeuft', 3000);
            await bisWahr('!zt.laeuft', 20000);
            neu.zyklenFehler = await js('({ ok: zt.ok, fehler: zt.fehler, status: document.getElementById("zt-status").textContent, ausgang: zustand.ausgang })');
            fs.writeFileSync(bildName('pruefstand'), (await frischesBild()).toPNG());

            // SPM-25 Verlauf: Mausrad zoomt, Umschalt+Ziehen markiert, Bild speichern/kopieren, Doppelklick zurück
            await js("document.querySelector('.tab[data-seite=\"seite-live\"]').click()");
            await warten(400);
            const kurve = await js("(() => { const r = KURVEN[0].canvas.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()");
            await js(`KURVEN[0].canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: ${kurve.l + kurve.w * 0.6}, clientY: ${kurve.t + 40}, bubbles: true, cancelable: true }))`);
            const zeiger = (art, x, shift) => js(`KURVEN[0].canvas.dispatchEvent(new PointerEvent('${art}', { clientX: ${x}, clientY: ${kurve.t + 40}, button: 0, pointerId: 1, shiftKey: ${shift}, bubbles: true }))`);
            await zeiger('pointerdown', kurve.l + kurve.w * 0.45, true);
            await zeiger('pointermove', kurve.l + kurve.w * 0.7, true);
            await zeiger('pointerup', kurve.l + kurve.w * 0.7, true);
            await warten(500);
            neu.verlauf = await js("({ ansicht: !!zustand.ansicht, knopf: document.getElementById('anhalten').textContent, auswahl: !!zustand.auswahl, info: document.getElementById('auswahl-info').textContent })");
            fs.writeFileSync(bildName('ausschnitt'), (await frischesBild()).toPNG());
            await js("document.getElementById('bild-speichern').click()");
            await warten(1200);
            const bilder = fs.readdirSync(app.getPath('userData')).filter((n) => /^Verlauf_.*\.png$/.test(n));
            neu.bild = bilder.length ? fs.readFileSync(path.join(app.getPath('userData'), bilder[0])).subarray(1, 4).toString() : '';
            neu.kopiert = await js('window.spm.bildKopieren(bildAusLeinwaenden(verlaufTeile()))');
            await js("KURVEN[0].canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
            await warten(300);
            neu.zurueck = await js("({ ansicht: zustand.ansicht, auswahl: zustand.auswahl, knopf: document.getElementById('anhalten').textContent })");

            // SPM-26 Messbericht als PDF
            await js("berichtDialog(); document.getElementById('br-titel').value = 'Testbericht'; document.getElementById('br-notiz').value = 'Selbsttest'; document.getElementById('br-ok').click()");
            await bisWahr("!document.getElementById('bericht-dialog').open", 20000);
            const pdfs = fs.readdirSync(app.getPath('userData')).filter((n) => /^Testbericht_.*\.pdf$/.test(n));
            const pdf = pdfs.length ? fs.readFileSync(path.join(app.getPath('userData'), pdfs[0])) : Buffer.alloc(0);
            neu.bericht = { datei: pdfs[0] ?? null, kopf: pdf.subarray(0, 5).toString(), groesse: pdf.length };
            // Bild der Berichtsseite (das HTML, aus dem das PDF gedruckt wurde), etwa A4-Breite
            const blatt = new BrowserWindow({ width: 794, height: 2400, useContentSize: true, show: false, webPreferences: { sandbox: true, javascript: false, offscreen: true } });
            await blatt.loadFile(datei('bericht.html'));
            await warten(800);
            blatt.webContents.invalidate(); await warten(300);
            try { fs.writeFileSync(bildName('bericht'), (await blatt.webContents.capturePage()).toPNG()); } catch (e) { fehler.push('Bericht-Bild: ' + e.message); }
            blatt.destroy();

            // SPM-27 Fernanzeige: Code nötig, Daten mit Code, „Ausgang aus“ nur wenn erlaubt, Sperre nach falschen Codes
            await js("fernDialog(); document.getElementById('fe-port').value = '18765'; document.getElementById('fe-an').click()");
            await bisWahr('fe.laeuft', 5000);
            await warten(1200);
            fs.writeFileSync(bildName('fern'), (await frischesBild()).toPNG());
            const code = await js('feEinst.code');
            const adresse = 'http://127.0.0.1:18765';
            const holen = async (pfad, optionen = {}) => { try { const r = await fetch(adresse + pfad, optionen); return { status: r.status, text: await r.text(), cookie: r.headers.get('set-cookie') }; } catch (e) { return { status: 0, text: String(e) }; } };
            const ohne = await holen('/daten');
            const mit = await holen('/daten', { headers: { 'x-code': code } });
            const seite = await holen('/?code=' + code);
            await js('ausgangSchalten(true)');
            await warten(800);
            // Die Handy-Seite einmal in Handygröße öffnen – offscreen gezeichnet, ein zweites durchsichtiges Fenster lässt sich nicht abfotografieren
            const handy = new BrowserWindow({ width: 390, height: 844, useContentSize: true, show: false, webPreferences: { sandbox: true, offscreen: true } });
            await handy.loadURL(`${adresse}/?code=${code}`);
            await warten(2500);
            handy.webContents.invalidate(); await warten(400);
            try { fs.writeFileSync(bildName('handy'), (await handy.webContents.capturePage()).toPNG()); } catch (e) { fehler.push('Handy-Bild: ' + e.message); }
            const handyText = await handy.webContents.executeJavaScript("document.getElementById('status').textContent + ' | ' + document.getElementById('u').textContent");
            handy.destroy();
            const verboten = await holen('/aus', { method: 'POST', headers: { 'x-code': code } });
            await js("document.getElementById('fe-notaus').click()");
            await warten(400);
            const erlaubt = await holen('/aus', { method: 'POST', headers: { 'x-code': code } });
            await warten(1200);
            const nachAus = await js('zustand.ausgang');
            for (let n = 0; n < 11; n++) await holen('/daten', { headers: { 'x-code': '000000' } });
            const gesperrtAntwort = await holen('/daten', { headers: { 'x-code': code } });
            neu.fern = {
                ohne: ohne.status, mit: mit.status, hatWerte: /"u":/.test(mit.text), seite: seite.status, cookie: /spmcode=/.test(seite.cookie ?? ''),
                verboten: verboten.status, erlaubt: erlaubt.status, ausgangDanach: nachAus, sperre: gesperrtAntwort.status,
                qr: await js("!document.getElementById('fe-qr').hidden"), adressen: await js('fe.adressen.length'), handy: handyText,
            };
            await js("document.getElementById('fe-an').click(); document.getElementById('fern-dialog').close()");
            await warten(500);
            await js("document.getElementById('fe-notaus').checked = false; document.getElementById('fe-notaus').dispatchEvent(new Event('change'))");
            zusatz.neu = neu;

            // Hell/Dunkel: Vorgabe dunkel, Knopf schaltet um, Wahl bleibt gespeichert, Strg+Umschalt+L schaltet zurück
            const thema = { vorgabe: await js('document.documentElement.dataset.thema') };
            await js("document.getElementById('thema-knopf').click()");
            await warten(400);
            Object.assign(thema, await js(`({ jetzt: document.documentElement.dataset.thema, gespeichert: localStorage.getItem('spm6103.thema'),
                hintergrund: getComputedStyle(document.body).backgroundColor, menue: document.getElementById('menue-thema').textContent })`));
            thema.programm = jsonLesen('einstellungen.json').thema;
            fs.writeFileSync(bildName('hell-live'), (await frischesBild()).toPNG());
            for (const seite of ['seite-auto', 'seite-kennlinie', 'seite-aufz']) {
                await js(`document.querySelector('.tab[data-seite="${seite}"]').click()`);
                await warten(500);
                fs.writeFileSync(bildName('hell-' + seite.replace('seite-', '')), (await frischesBild()).toPNG());
            }
            await js("document.querySelector('.tab[data-seite=\"seite-live\"]').click()");
            await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', ctrlKey: true, shiftKey: true }))");
            await warten(400);
            thema.zurueck = await js('document.documentElement.dataset.thema');
            thema.hintergrundDunkel = await js('getComputedStyle(document.body).backgroundColor');
            zusatz.thema = thema;

            const z = zusatz;
            const zusatzOk = z.vorlageFragt && z.vorlage.volt === 12 && z.vorlage.curr === 2 && z.vorlage.ovp === 13.1
                && z.markierung.ereignis && z.markierung.inDaten && z.alarm && z.abschalten
                && z.ablaufLaeuft && z.ablauf && z.ablaufEnde.volt === 6 && z.ablaufEnde.ausgang === false
                && z.kennlinie.punkte >= 10 && z.kennlinie.letzterModus === 2 && z.akku.status === 'fertig' && z.akku.mah > 1 && z.akku.ausgang === false
                && z.bauteile.gut + z.bauteile.schlecht >= 2 && z.laufend.dateien === 1 && z.laufend.zeilen > 50 && z.laufend.markierung && z.laufend.kopf
                && z.vergleich.reihen === 2 && !z.liveScrollt
                && z.thema.vorgabe === 'dunkel' && z.thema.jetzt === 'hell' && z.thema.gespeichert === 'hell' && z.thema.programm === 'hell'
                && z.thema.hintergrund === 'rgb(238, 241, 245)' && z.thema.zurueck === 'dunkel' && z.thema.hintergrundDunkel === 'rgb(14, 17, 21)'
                && z.neu.fein === 5.13 && z.neu.feinGrenze === 5.19
                && z.neu.ersteinGut.gut === true && z.neu.ersteinSchlecht.gut === false && z.neu.ersteinSchlecht.ausgang === false
                && z.neu.zyklenGut.ok === 3 && z.neu.zyklenGut.fehler === 0 && z.neu.zyklenFehler.fehler === 1 && z.neu.zyklenFehler.ok === 0 && z.neu.zyklenFehler.ausgang === false
                && z.neu.verlauf.ansicht && z.neu.verlauf.knopf === 'Weiter' && z.neu.verlauf.auswahl && z.neu.verlauf.info.startsWith('Ausschnitt')
                && z.neu.bild === 'PNG' && z.neu.kopiert === true && z.neu.zurueck.ansicht === null && z.neu.zurueck.knopf === 'Anhalten'
                && z.neu.bericht.kopf === '%PDF-' && z.neu.bericht.groesse > 20000
                && z.neu.fern.ohne === 401 && z.neu.fern.mit === 200 && z.neu.fern.hatWerte && z.neu.fern.seite === 200 && z.neu.fern.cookie
                && z.neu.fern.verboten === 403 && z.neu.fern.erlaubt === 200 && z.neu.fern.ausgangDanach === false && z.neu.fern.sperre === 429
                && /^Demo-Modus \| \d/.test(z.neu.fern.handy);

            // Versionsvergleich
            const faelle = [['1.0.3', '1.0.2', 1], ['1.0.2', '1.0.2', 0], ['v1.10.0', '1.9.9', 1], ['1.0.2', '1.0.10', -1], ['2.0.0-beta', '2.0.0', -1], ['2.0', '2.0.0', 0]];
            const vergleich = faelle.filter(([a, b, soll]) => versionVergleich(a, b) !== soll).map((f) => f.join(' / '));

            // Versionspruefung beim Start: muss fertig sein, mit einem der drei Zustaende
            await warten(2000);
            const pruefung = await js(`({ symbol: document.getElementById('version-knopf').className, text: document.getElementById('version-text').textContent,
                grund: version.ergebnis?.grund ?? version.ergebnis?.neueste ?? null })`);

            // Menue oeffnen
            await js("document.getElementById('menue-knopf').click()");
            await warten(300);
            const menue = await js("({ offen: document.getElementById('menue').classList.contains('offen'), punkte: [...document.querySelectorAll('#menue button')].map(b => b.innerText.replace(/\\s+/g, ' ').trim()) })");
            fs.writeFileSync(bildName('menue'), (await frischesBild()).toPNG());

            // Versionsdialog, einmal mit einem vorgetaeuschten Update
            await js("document.querySelector('#menue [data-aktion=\"updates\"]').click()");
            await warten(300);
            await js(`version.ergebnis = { status: 'neu', installiert: version.installiert, neueste: '9.9.9', datum: new Date().toISOString(), geprueft: Date.now(),
                notizen: '- **Beispiel:** so sehen die Release-Notizen aus\\n- zweite Zeile', seite: 'https://github.com/3d-cnc/OWON-SPM6103/releases' }; versionAnzeigen()`);
            await warten(200);
            const update = await js("({ dialog: document.getElementById('versionsdialog').open, knopf: document.getElementById('version-knopf').className, titel: document.getElementById('v-titel').textContent, menuePunkt: document.getElementById('menue').classList.contains('update') })");
            fs.writeFileSync(bildName('update'), (await frischesBild()).toPNG());
            await js("document.getElementById('v-schliessen').click()");

            // Fenstergroesse: 1600 x 900 waehlen, muss sofort gelten und gespeichert sein
            await js('groessenDialog()');
            await warten(400);
            fs.writeFileSync(bildName('groesse'), (await frischesBild()).toPNG());
            const groesse = await js(`(() => { const r = [...document.querySelectorAll('#groessen input[type=radio]')];
                const vorher = r.find(x => x.checked)?.value; r.find(x => x.value === '1600x900').click(); document.getElementById('g-ok').click();
                return { auswahl: r.length, vorher }; })()`);
            await warten(800);
            Object.assign(groesse, await js("({ fenster: innerWidth + ' x ' + innerHeight, quer: document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth + 1, menue: document.getElementById('menue-groesse').textContent })"));
            groesse.gespeichert = jsonLesen('einstellungen.json');
            fs.writeFileSync(bildName('1600'), (await frischesBild()).toPNG());

            const ok =schnittstelle.serial && schnittstelle.bruecke === 'object' && portwahl.offen && /Verbinden$/.test(portwahl.ergebnis)
                && werte.modus === 'CC' && werte.punkte > 5 && werte.vorStart === 0 && werte.err.einmal === 0 && werte.err.zweimal === 1 && werte.err.rest === 0 && flaeche.fenster === `${BREITE} x ${HOEHE}` && !flaeche.scrollt
                && konsole.eintraege > 40 && konsole.scrollbar && konsole.amEnde && konsole.kurveNachher === flaeche.kurve && konsole.sichtbar >= 6 && konsole.luecke <= 12
                && aufz.zeilen > 5 && aufz.kennwerte >= 4 && !aufz.scrollt && aufz.status === 'läuft'
                && aufz.stopp.gleich && aufz.stopp.status === 'aus' && aufz.stopp.start && aufz.stopp.liveWeiter && aufz.weiter
                && vergleich.length === 0 && ['aktuell', 'neu', 'unbekannt'].includes(pruefung.symbol) && /^v\d+\.\d+\.\d+$/.test(pruefung.text)
                && menue.offen && menue.punkte.length === 6 && update.dialog && update.knopf === 'neu' && update.menuePunkt
                && groesse.vorher === '1920x1080' && groesse.fenster === '1600 x 900' && !groesse.quer && groesse.gespeichert.breite === 1600
                && zusatzOk && fehler.length === 0;
            console.log(JSON.stringify({ ok, zusatzOk, zusatz, schnittstelle, portwahl, werte, flaeche, aufz, vergleich, pruefung, menue, update, groesse, fehler, bild: bildDatei }, null, 1));
            app.exit(ok ? 0 : 1);
        } catch (e) {
            console.log(JSON.stringify({ ok: false, ausnahme: String(e), fehler }, null, 1));
            app.exit(1);
        }
    });
}

/* ------------------------------------------------------------ Gerätetest am echten Netzteil */

// Bedient das Programm wie ein Mensch und sammelt jede Fehlermeldung. Ohne --mit-ausgang bleibt der
// Ausgang aus (Abbruch, falls er bei Testbeginn schon an ist). Am Ende stellt er die Werte wieder her.
function geraetLaufen() {
    const fehler = [];
    const ordner = pruefen.includes('=') ? path.dirname(pruefen.split('=')[1]) : os.tmpdir();
    const js = (code) => fenster.webContents.executeJavaScript(code);
    const warten = (ms) => new Promise((weiter) => setTimeout(weiter, ms));
    const bisWahr = async (ausdruck, ms) => { for (let n = 0; n < ms / 250; n++) { if (await js(ausdruck)) return true; await warten(250); } return false; };
    const ergebnis = { port: geraetPort, mitAusgang, schritte: {} };
    const schritt = (name, wert) => { ergebnis.schritte[name] = wert; };

    fenster.webContents.on('console-message', (e) => { if (e.level === 'error') fehler.push(e.message); });

    fenster.webContents.once('did-finish-load', async () => {
        try {
            // Alles mitschreiben, was im Log landet – auch über die 500 Zeilen der Konsole hinaus
            await js(`window._logs = []; { const alt = log; log = (t, a = 'info') => { _logs.push([Date.now(), a, String(t)]); alt(t, a); }; } 1`);
            await warten(500);
            const knopf = await js("(() => { const r = document.getElementById('verbinden').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
            fenster.webContents.sendInputEvent({ type: 'mouseDown', x: knopf.x, y: knopf.y, button: 'left', clickCount: 1 });
            fenster.webContents.sendInputEvent({ type: 'mouseUp', x: knopf.x, y: knopf.y, button: 'left', clickCount: 1 });
            if (!await bisWahr('zustand.laeuft && !!zustand.faehig.psu', 20000)) throw new Error('keine Verbindung zu ' + geraetPort);
            schritt('verbunden', await js("({ status: document.getElementById('status-text').textContent, idn: document.getElementById('idn').textContent, faehig: zustand.faehig })"));

            // Ein paar Sekunden messen lassen
            const vorher = await js('zustand.live.length');
            await warten(6000);
            schritt('messen', await js(`({ punkte: zustand.live.length - ${vorher}, rate: document.getElementById('rate').textContent, letzter: zustand.letzter, ausgang: zustand.ausgang, soll: zustand.soll })`));
            const geraet = async (b) => js(`frage(${JSON.stringify(b)}).catch(e => 'FEHLER: ' + e.message)`);
            const urspruenglich = { volt: await geraet('VOLT?'), curr: await geraet('CURR?'), ovp: await geraet('VOLT:LIM?'), ocp: await geraet('CURR:LIM?') };
            schritt('urspruenglich', urspruenglich);
            if (await js('zustand.ausgang') !== false && !mitAusgang) throw new Error('Der Ausgang ist eingeschaltet – Gerätetest ohne --mit-ausgang bricht ab, ohne etwas zu ändern');

            // Sollwerte über die Eingabefelder
            for (const [feld, wert] of [['e-volt', '5'], ['e-curr', '0,5'], ['e-ovp', '6'], ['e-ocp', '0,6']]) {
                await js(`document.getElementById('${feld}').value = '${wert}'; document.getElementById('${feld}').nextElementSibling.click()`);
                await warten(900);
            }
            schritt('sollwerte', { volt: await geraet('VOLT?'), curr: await geraet('CURR?'), ovp: await geraet('VOLT:LIM?'), ocp: await geraet('CURR:LIM?'), anzeige: await js('zustand.soll') });

            // Feinverstellung: dreimal +10 mV
            for (let n = 0; n < 3; n++) await js("document.querySelector('.sollwert').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))");
            await warten(1500);
            schritt('feinverstellung', { volt: await geraet('VOLT?'), anzeige: await js('zustand.soll.volt') });

            // Vorlage „5 V USB“ bei ausgeschaltetem Ausgang: ohne Rückfrage
            await js("[...document.querySelectorAll('#vorlagen .vorlage')].find(k => k.textContent.startsWith('5 V USB')).click()");
            await warten(2500);
            schritt('vorlage', { volt: await geraet('VOLT?'), curr: await geraet('CURR?'), ovp: await geraet('VOLT:LIM?'), ocp: await geraet('CURR:LIM?'), dialog: await js("document.getElementById('frage-dialog').open") });

            // Multimeter: jede Messfunktion, bei Bereichen jeden Bereich und zurück auf Automatisch
            const dmm = [];
            for (const f of await js('Object.keys(FUNKTIONEN)')) {
                await js(`document.querySelector('#funktionen button[data-f="${f}"]').click()`);
                await warten(2200);
                const st = await js('({ funktion: zustand.funktion, anzeige: zustand.dmmAnzeige, auto: zustand.dmmAuto, bereich: zustand.dmmBereich })');
                const eintrag = { soll: f, ist: st.funktion, anzeige: st.anzeige && `${st.anzeige.anzeige} ${st.anzeige.einheit}`, auto: st.auto, bereich: st.bereich, bereiche: [] };
                const optionen = await js("[...document.getElementById('bereich').options].map(o => [o.value, o.text])");
                if (await js("!document.getElementById('bereich').disabled")) {
                    for (const [wert, text] of [...optionen.filter(([w]) => w !== 'auto'), ...optionen.filter(([w]) => w === 'auto')]) {
                        await js(`(() => { const s = document.getElementById('bereich'); s.value = '${wert}'; s.dispatchEvent(new Event('change')); })()`);
                        await warten(500);
                        await bisWahr('!bereichPrueft', 8000);   // wie ein Mensch: erst weiter, wenn die Wahl übernommen ist
                        await warten(800);
                        const b = await js('({ auto: zustand.dmmAuto, bereich: zustand.dmmBereich, wahl: document.getElementById("bereich").value })');
                        const passt = wert === 'auto' ? b.auto === true : b.auto === false && String(b.bereich).replace(/\s/g, '').toLowerCase() === text.replace(/\s/g, '').toLowerCase();
                        eintrag.bereiche.push({ gewaehlt: text, geraet: `${b.auto ? 'Auto' : 'Manuell'} ${b.bereich}`, passt });
                    }
                }
                dmm.push(eintrag);
            }
            schritt('multimeter', dmm);

            // Hold und Relativ
            await js("document.querySelector('#funktionen button[data-f=\"VOLT:DC\"]').click()");
            await warten(2000);
            await js("document.getElementById('hold').click()"); await warten(1200);
            const holdAn = await geraet('MULT:HOLD?');
            await js("document.getElementById('hold').click()"); await warten(1200);
            const holdAus = await geraet('MULT:HOLD?');
            await js("document.getElementById('rel').click()"); await warten(1500);
            const relAnzeige = await js('zustand.dmmAnzeige && zustand.dmmAnzeige.anzeige');
            await js("document.getElementById('rel').click()"); await warten(1500);
            schritt('holdRel', { holdAn, holdAus, relAnzeige, relKnopf: await js("document.getElementById('rel').classList.contains('aktiv')") });

            // Alarm auf den Multimeter-Wert (ohne Abschalten): „Multimeter über −1“ löst sicher aus
            await js(`alRegeln.splice(0, alRegeln.length, { an: true, groesse: 'dmm', vergleich: 'ueber', wert: '-1', aktion: 'alarm' }); alZeichnen(); document.getElementById('al-ton').checked = false; document.getElementById('al-aktiv').click()`);
            const alarm = await bisWahr("document.getElementById('alarm-leiste').classList.contains('sichtbar')", 5000);
            await js("document.getElementById('alarm-quittieren').click(); document.getElementById('al-aktiv').click()");
            schritt('alarmMultimeter', alarm);

            // Bauteilprüfung: ohne angeschlossenes Bauteil muss „OL“ / „Bauteil anlegen“ kommen
            await js(`document.getElementById('bt-funktion').value = 'RES'; document.getElementById('bt-funktion').dispatchEvent(new Event('change')); document.querySelector('.tab[data-seite="seite-bauteile"]').click()`);
            await warten(3500);
            schritt('bauteile', await js("({ wert: document.getElementById('bt-wert').textContent, text: document.getElementById('bt-text').textContent, gezaehlt: bt.gut + bt.schlecht })"));
            await js("document.querySelector('.tab[data-seite=\"seite-live\"]').click()");

            // Fernanzeige liefert echte Werte
            await js("fernDialog(); document.getElementById('fe-port').value = '18766'; document.getElementById('fe-an').click()");
            await bisWahr('fe.laeuft', 5000);
            await warten(1500);
            const code = await js('feEinst.code');
            let fern;
            try { const r = await fetch('http://127.0.0.1:18766/daten', { headers: { 'x-code': code } }); fern = await r.json(); } catch (e) { fern = { fehler: String(e) }; }
            await js("document.getElementById('fe-an').click(); document.getElementById('fern-dialog').close()");
            schritt('fernanzeige', { verbunden: fern.verbunden, demo: fern.demo, u: fern.u, dmm: fern.dmm });

            // Mit eingeschaltetem Ausgang – nur mit --mit-ausgang, höchstens 2 V und 50 mA
            if (mitAusgang) {
                const aus = await js('ausgangSchalten(false).then(() => zustand.ausgang)');
                await js('sollwerteSetzen({ volt: 1, curr: 0.05, ovp: 3, ocp: 0.1 })');
                await warten(800);
                // Ausgang von Hand ein und aus
                await js("document.getElementById('ausgang').click()");
                await warten(2500);
                const an = { outp: await geraet('OUTP?'), messung: await js('zustand.letzter'), knopf: await js("document.getElementById('ausgang').textContent") };
                await js("document.getElementById('ausgang').click()");
                await warten(1500);
                schritt('ausgang', { vorher: aus, an, danach: await geraet('OUTP?') });

                // Abschalten nach 3 s
                await js(`for (const [id, w] of [['ab-zeit-an', true], ['ab-wh-an', false], ['ab-ah-an', false], ['ab-unter-an', false]]) document.getElementById(id).checked = w;
                    document.getElementById('ab-h').value = '0'; document.getElementById('ab-min').value = '0'; document.getElementById('ab-s').value = '3';
                    ausgangSchalten(true).then(() => document.getElementById('ab-start').click())`);
                const abgeschaltet = await bisWahr("document.getElementById('ab-status').textContent === 'abgeschaltet'", 12000);
                schritt('abschalten', { abgeschaltet, outp: await geraet('OUTP?') });

                // Ablaufprogramm: 1 V, dann Rampe auf 2 V, je 3 s
                await js(`apProgramm = { schritte: [{ volt: 1, curr: 0.05, dauer: 3, rampe: false }, { volt: 2, curr: 0.05, dauer: 3, rampe: true }], wdh: 1, ende: 'aus' }; apZeichnen(); document.getElementById('ap-start').click()`);
                await warten(4500);
                const mitten = await js('zustand.letzter && zustand.letzter.u');
                await bisWahr("document.getElementById('ap-status').textContent !== 'läuft'", 15000);
                schritt('ablauf', { status: await js("document.getElementById('ap-status').textContent"), spannungInDerRampe: mitten, volt: await geraet('VOLT?'), outp: await geraet('OUTP?') });

                // Erst-Einschalten bis 2 V mit 50 mA
                await js(`for (const [id, w] of [['ee-name', 'Gerätetest'], ['ee-ziel', '2'], ['ee-strom', '0,05'], ['ee-rampe', '3'], ['ee-grenze', '0,04'], ['ee-halten', '2']]) document.getElementById(id).value = w;
                    document.getElementById('ee-anlassen').checked = false; document.getElementById('ee-start').click()`);
                await bisWahr('ee.laeuft', 3000);
                await bisWahr('!ee.laeuft', 25000);
                schritt('ersteinschalten', { ergebnis: await js('ee.protokoll.at(-1)'), outp: await geraet('OUTP?') });

                // Zyklentest: 2 Zyklen mit 1 V, Strom 0–50 mA erwartet
                await js(`for (const [id, w] of [['zt-volt', '1'], ['zt-curr', '0,05'], ['zt-an', '2'], ['zt-aus', '1'], ['zt-zyklen', '2'], ['zt-einschwing', '0,5'], ['zt-min', '0'], ['zt-max', '0,05'], ['zt-fehler', 'halt']]) document.getElementById(id).value = w;
                    document.getElementById('zt-start').click()`);
                await bisWahr('zt.laeuft', 3000);
                await bisWahr('!zt.laeuft', 25000);
                schritt('zyklentest', { ok: await js('zt.ok'), fehler: await js('zt.fehler'), protokoll: await js('zt.protokoll'), outp: await geraet('OUTP?') });

                // Kennlinie 0 … 2 V in 0,5-V-Schritten, 20 mA Grenze
                await js(`for (const [id, w] of [['kl-name', 'Gerätetest'], ['kl-von', '0'], ['kl-bis', '2'], ['kl-schritt', '0,5'], ['kl-strom', '0,02'], ['kl-warten', '400']]) document.getElementById(id).value = w;
                    document.getElementById('kl-aus').checked = true; document.getElementById('kl-messen').click()`);
                await bisWahr('kl.laeuft', 3000);
                await bisWahr('!kl.laeuft', 25000);
                schritt('kennlinie', { punkte: await js('klKurven.at(-1).punkte'), outp: await geraet('OUTP?') });

                // Fernanzeige: „Ausgang aus“ vom Handy
                await js('ausgangSchalten(true)');
                await warten(1200);
                await js("fernDialog(); document.getElementById('fe-port').value = '18766'; document.getElementById('fe-notaus').checked = true; document.getElementById('fe-notaus').dispatchEvent(new Event('change')); document.getElementById('fe-an').click()");
                await bisWahr('fe.laeuft', 5000);
                const fcode = await js('feEinst.code');
                let antwort;
                try { antwort = (await fetch('http://127.0.0.1:18766/aus', { method: 'POST', headers: { 'x-code': fcode } })).status; } catch (e) { antwort = String(e); }
                await warten(1500);
                schritt('fernAus', { antwort, outp: await geraet('OUTP?') });
                await js("document.getElementById('fe-an').click(); document.getElementById('fern-dialog').close()");
                await js('ausgangSchalten(false)');
            }

            // Alles zurück: Sollwerte wie vorher, Multimeter auf Gleichspannung automatisch
            const zahlAus = (s) => Number(String(s).replace(',', '.'));
            await js(`sollwerteSetzen({ volt: ${zahlAus(urspruenglich.volt)}, curr: ${zahlAus(urspruenglich.curr)}, ovp: ${zahlAus(urspruenglich.ovp)}, ocp: ${zahlAus(urspruenglich.ocp)} })`);
            await warten(1000);
            await js("document.querySelector('#funktionen button[data-f=\"VOLT:DC\"]').click()");
            await warten(2000);
            schritt('wiederhergestellt', { volt: await geraet('VOLT?'), curr: await geraet('CURR?'), ovp: await geraet('VOLT:LIM?'), ocp: await geraet('CURR:LIM?'), ausgang: await geraet('OUTP?'), multimeter: await js('zustand.funktion') });

            // Trennen (schickt SYST:LOC)
            await js("document.getElementById('verbinden').click()");
            await warten(1500);
        } catch (e) {
            fehler.push('Ausnahme: ' + (e.stack || e));
        } finally {
            const logs = await js('window._logs || []').catch(() => []);
            fs.writeFileSync(path.join(ordner, 'geraet-log.txt'), logs.map(([t, a, x]) => `${new Date(t).toLocaleTimeString('de-DE')} ${a.padEnd(4)} ${x}`).join('\n'), 'utf8');
            ergebnis.logFehler = logs.filter(([, a]) => a === 'err').map(([t, , x]) => `${new Date(t).toLocaleTimeString('de-DE')} ${x}`);
            ergebnis.fehler = fehler;
            console.log(JSON.stringify(ergebnis, null, 1));
            app.exit(fehler.length || ergebnis.logFehler.length ? 1 : 0);
        }
    });
}
