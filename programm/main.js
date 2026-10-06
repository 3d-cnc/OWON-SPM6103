/*
 * OWON SPM6103 - Live-Anzeige als Windows-Programm.
 *
 * Die Oberflaeche (app/index.html) spricht ueber Web Serial mit dem Netzteil.
 * In einem normalen Browser waehlt Chrome den Port selbst aus; hier uebernimmt
 * das Programm diese Rolle: es reicht die Liste der COM-Ports an die Seite
 * weiter, die zeigt ihren eigenen Auswahldialog.
 *
 *  - Fenstergroesse und -position bleiben gespeichert (fenster.json).
 *  - CSV-Dateien gehen ueber den Windows-Speicherdialog.
 *  - Beim Schliessen mit nicht gespeicherten Messdaten fragt das Programm nach.
 *
 * `electron . --pruefen[=bild.png]` startet ohne sichtbares Fenster im
 * Demo-Modus, bedient ein paar Knoepfe, speichert ein Bild und beendet sich -
 * mit Fehlercode, wenn die Seite Fehler gemeldet hat.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pruefen = process.argv.find((a) => a.startsWith('--pruefen'));

if (pruefen) {
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'owon-spm6103-pruefen-')));
}

let fenster = null;
let portRueckruf = null;
let portListe = [];

/* ------------------------------------------------------------ Fensterlage */

// Die Oberflaeche ist auf 1920 x 1080 ausgelegt: so gross ist der Fensterinhalt bei jedem Start.
// Gemerkt wird nur, wo das Fenster lag (und ob maximiert) - nicht die Groesse.
const BREITE = 1920;
const HOEHE = 1080;
const lageDatei = () => path.join(app.getPath('userData'), 'fenster.json');

function lageLesen() {
    let lage = {};
    try {
        lage = JSON.parse(fs.readFileSync(lageDatei(), 'utf8'));
    } catch {
        /* erster Start */
    }
    // Bildschirm, auf dem das Fenster zuletzt lag - sonst der, auf dem die Maus steht
    const punkt = Number.isFinite(lage.x) ? { x: lage.x + 100, y: lage.y + 50 } : screen.getCursorScreenPoint();
    const b = screen.getDisplayNearestPoint(punkt).workArea;
    const passt = BREITE <= b.width && HOEHE + 40 <= b.height;
    // Rahmen und Titelleiste kommen noch dazu; zu kleiner Bildschirm: maximiert
    const x = Number.isFinite(lage.x) ? Math.min(Math.max(lage.x, b.x), b.x + b.width - BREITE) : b.x + Math.round((b.width - BREITE) / 2);
    const y = Number.isFinite(lage.y) ? Math.min(Math.max(lage.y, b.y), b.y + b.height - HOEHE - 40) : b.y + Math.max(0, Math.round((b.height - HOEHE - 40) / 2));
    return passt ? { x, y, maximiert: !!lage.maximiert } : { maximiert: true };
}

function lageSpeichern() {
    if (!fenster || pruefen) return;
    const maximiert = fenster.isMaximized();
    const { x, y } = maximiert ? fenster.getNormalBounds() : fenster.getBounds();
    try {
        fs.mkdirSync(path.dirname(lageDatei()), { recursive: true });
        fs.writeFileSync(lageDatei(), JSON.stringify({ x, y, maximiert }));
    } catch {
        /* nicht schlimm */
    }
}

/* ------------------------------------------------------------ Fenster */

function fensterOeffnen() {
    const lage = lageLesen();

    fenster = new BrowserWindow({
        x: lage.x,
        y: lage.y,
        width: BREITE,
        height: HOEHE,
        useContentSize: true,
        minWidth: 720,
        minHeight: 520,
        show: false,
        title: 'OWON SPM6103',
        icon: path.join(__dirname, 'build', 'icon.png'),
        backgroundColor: '#0e1115',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            // Messen soll auch minimiert im vollen Takt weiterlaufen
            backgroundThrottling: false,
        },
    });

    fenster.setMenuBarVisibility(false);
    const sitzung = fenster.webContents.session;

    // Serielle Schnittstellen ohne Rueckfrage erlauben - die Seite fragt selbst, welcher Port
    sitzung.setPermissionCheckHandler((_wc, recht) => recht === 'serial');
    sitzung.setDevicePermissionHandler((details) => details.deviceType === 'serial');

    sitzung.on('select-serial-port', (ereignis, ports, _wc, rueckruf) => {
        ereignis.preventDefault();
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
        fensterOeffnen();
        if (pruefen) pruefenLaufen();
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
                punkte: zustand.daten.length, meldung: document.getElementById('meldung').textContent })`);
            // Auf 1920 x 1080 muss die Live-Seite ohne Scrollen passen
            const flaeche = await js(`(() => { const m = document.querySelector('main');
                return { fenster: innerWidth + ' x ' + innerHeight, scrollt: m.scrollHeight > m.clientHeight + 1 || m.scrollWidth > m.clientWidth + 1,
                         kurve: document.querySelector('#diagramme canvas').clientHeight }; })()`);
            // Viele Konsolen-Einträge dürfen den Verlauf nicht zusammendrücken: 6 sichtbar, der Rest scrollt
            const konsole = await js(`(() => {
                for (let n = 1; n <= 40; n++) log('Testeintrag ' + n + ' ' + 'mit langem Text '.repeat(n % 3 ? 1 : 12), n % 2 ? 'aus' : 'ein');
                const el = document.getElementById('konsole-log'), zeile = el.lastElementChild.getBoundingClientRect().height;
                const innen = el.clientHeight - parseFloat(getComputedStyle(el).paddingTop) - parseFloat(getComputedStyle(el).paddingBottom);
                return { eintraege: el.childElementCount, sichtbar: Math.round(innen / zeile * 10) / 10, scrollbar: el.scrollHeight > el.clientHeight, amEnde: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
                         kurveNachher: document.querySelector('#diagramme canvas').clientHeight }; })()`);
            flaeche.konsole = konsole;
            fs.writeFileSync(bildDatei, (await frischesBild()).toPNG());

            // Tab 2: Aufzeichnung
            await js("document.querySelector('.tab[data-seite=\"seite-aufz\"]').click()");
            await warten(800);
            const aufz = await js(`({ zeilen: document.querySelectorAll('#tabelle-zeilen .tz').length, anzahl: document.getElementById('anzahl').textContent,
                kennwerte: document.querySelectorAll('#kennwerte tr').length, energie: document.getElementById('energie').textContent,
                zaehler: document.getElementById('tab-zaehler').textContent,
                scrollt: document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight + 1 })`);
            fs.writeFileSync(bildDatei.replace(/\.png$/i, '') + '-aufzeichnung.png', (await frischesBild()).toPNG());

            const ok = schnittstelle.serial && schnittstelle.bruecke === 'object' && portwahl.offen && /Verbinden$/.test(portwahl.ergebnis)
                && werte.modus === 'CC' && werte.punkte > 5 && flaeche.fenster === `${BREITE} x ${HOEHE}` && !flaeche.scrollt
                && konsole.eintraege > 40 && konsole.scrollbar && konsole.amEnde && konsole.kurveNachher === flaeche.kurve && Math.abs(konsole.sichtbar - 6) < 0.6
                && aufz.zeilen > 5 && aufz.kennwerte >= 4 && !aufz.scrollt && fehler.length === 0;
            console.log(JSON.stringify({ ok, schnittstelle, portwahl, werte, flaeche, aufz, fehler, bild: bildDatei }, null, 1));
            app.exit(ok ? 0 : 1);
        } catch (e) {
            console.log(JSON.stringify({ ok: false, ausnahme: String(e), fehler }, null, 1));
            app.exit(1);
        }
    });
}
