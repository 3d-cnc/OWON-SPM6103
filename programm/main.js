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

const { app, BrowserWindow, Menu, dialog, ipcMain, net, screen, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const paket = require('./package.json');

const pruefen = process.argv.find((a) => a.startsWith('--pruefen'));

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

let einstellungen = { breite: BREITE, hoehe: HOEHE, updatesBeimStart: true };

function einstellungenLesen() {
    const e = jsonLesen('einstellungen.json');
    einstellungen = {
        breite: gueltig(e.breite, GRENZEN.breite) ? e.breite : BREITE,
        hoehe: gueltig(e.hoehe, GRENZEN.hoehe) ? e.hoehe : HOEHE,
        updatesBeimStart: e.updatesBeimStart !== false,
    };
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

ipcMain.on('beenden', () => fenster?.close());   // fragt nach, wenn Messdaten ungespeichert sind

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

            // Tab 2: Aufzeichnung
            await js("document.querySelector('.tab[data-seite=\"seite-aufz\"]').click()");
            await warten(800);
            const aufz = await js(`({ zeilen: document.querySelectorAll('#tabelle-zeilen .tz').length, anzahl: document.getElementById('anzahl').textContent,
                kennwerte: document.querySelectorAll('#kennwerte tr').length, energie: document.getElementById('energie').textContent,
                zaehler: document.getElementById('tab-zaehler').textContent,
                scrollt: document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight + 1 })`);
            const bildName = (zusatz) => bildDatei.replace(/\.png$/i, '') + '-' + zusatz + '.png';
            fs.writeFileSync(bildName('aufzeichnung'), (await frischesBild()).toPNG());
            await js("document.querySelector('.tab[data-seite=\"seite-live\"]').click()");

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
                && werte.modus === 'CC' && werte.punkte > 5 && flaeche.fenster === `${BREITE} x ${HOEHE}` && !flaeche.scrollt
                && konsole.eintraege > 40 && konsole.scrollbar && konsole.amEnde && konsole.kurveNachher === flaeche.kurve && konsole.sichtbar >= 6 && konsole.luecke <= 12
                && aufz.zeilen > 5 && aufz.kennwerte >= 4 && !aufz.scrollt
                && vergleich.length === 0 && ['aktuell', 'neu', 'unbekannt'].includes(pruefung.symbol) && /^v\d+\.\d+\.\d+$/.test(pruefung.text)
                && menue.offen && menue.punkte.length === 3 && update.dialog && update.knopf === 'neu' && update.menuePunkt
                && groesse.vorher === '1920x1080' && groesse.fenster === '1600 x 900' && !groesse.quer && groesse.gespeichert.breite === 1600
                && fehler.length === 0;
            console.log(JSON.stringify({ ok, schnittstelle, portwahl, werte, flaeche, aufz, vergleich, pruefung, menue, update, groesse, fehler, bild: bildDatei }, null, 1));
            app.exit(ok ? 0 : 1);
        } catch (e) {
            console.log(JSON.stringify({ ok: false, ausnahme: String(e), fehler }, null, 1));
            app.exit(1);
        }
    });
}
