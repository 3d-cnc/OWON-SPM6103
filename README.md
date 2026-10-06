# OWON SPM6103

Windows-Programm, das Messwerte des Labornetzteils mit Multimeter **OWON SPM6103** live anzeigt und aufzeichnet. Es spricht über USB (CH340, SCPI) direkt mit dem Gerät und läuft als einzelne portable .exe.

- **Tab „Live“:** Spannung, Strom und Leistung, CV/CC, Schutzmeldungen, Ausgang und Sollwerte. Dazu der Multimeter-Wert mit Wahl der Messfunktion und des Messbereichs, eine SCPI-Konsole und vier Kurven.
- **Tab „Aufzeichnung“:** CSV-Export für Excel, Energie (Wh) und Ladung (Ah), Kennwerte der ganzen Aufzeichnung und eine Tabelle aller Messpunkte.
- **Menü:** Nach Updates suchen, Fenstergröße beim Start (Vorgabe 1920 × 1080) und Beenden.
- **Versionsprüfung:** Neben dem Namen stehen die Version und ein Symbol. Es ist grün, wenn das Programm aktuell ist, rot, wenn es ein Update gibt, und grau, wenn sich das nicht prüfen lässt. Gefragt wird nach dem neuesten GitHub-Release dieses Repositorys.
- Ein Demo-Modus funktioniert ohne Gerät.

Bedienung und Fehlersuche: [LIESMICH.txt](LIESMICH.txt). Stand und offene Punkte: [OFFEN.md](OFFEN.md).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `programm/app/index.html` | Oberfläche und Gerätelogik (Web Serial, SCPI, Kurven, Aufzeichnung, Demo-Gerät) |
| `programm/main.js` | Electron-Hülle: Fenster 1920 × 1080, Auswahl des COM-Ports, Speicherdialog, Selbsttest |
| `programm/preload.js` | Brücke zwischen Seite und Programm (`window.spm`) |
| `programm/build/icon.png` | Programmsymbol |

Die Befehle stammen aus OWONs *SPM Series Programming Manual*. Das Programm fragt `MEAS:ALL:INFO?` und `CONF:ALL?` ab. Versteht das Gerät eine dieser Abfragen nicht, nimmt es automatisch eine einfachere.

## Bauen

```
cd programm
npm install
node node_modules/electron/install.js
npm run bauen
```

`npm run bauen` legt `OWON SPM6103.exe` in den obersten Ordner. Die .exe selbst ist nicht im Repository.

## Selbsttest

```
cd programm
npx electron . --pruefen=bild.png
```

Der Selbsttest startet das Programm in einem durchsichtigen Fenster im Demo-Modus und klickt sich durch die Portauswahl, den Ausgang, einen Sollwert und die Messfunktion. Er prüft:
- dass die Live-Seite auf 1920 × 1080 ohne Scrollen passt,
- dass viele Konsolen-Einträge den Verlauf nicht zusammendrücken,
- den Versionsvergleich, die Versionsprüfung, das Menü und den Update-Hinweis,
- dass ein Wechsel der Fenstergröße auf 1600 × 900 sofort gilt und gespeichert wird.

Dabei speichert er Bilder der Tabs, des Menüs und der Dialoge. Bei einem Fehler endet er mit Exit-Code 1. Er funktioniert auch mit der fertigen .exe.
