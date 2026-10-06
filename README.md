# OWON SPM6103

Windows-Programm, das Messwerte des Labornetzteils mit Multimeter **OWON SPM6103** live anzeigt und aufzeichnet. Es spricht über USB (CH340, SCPI) direkt mit dem Gerät und läuft als einzelne portable .exe.

- **Tab „Live“:** Spannung, Strom und Leistung, CV/CC, Schutzmeldungen, Ausgang und Sollwerte. Dazu der Multimeter-Wert mit Wahl der Messfunktion und des Messbereichs, eine SCPI-Konsole und vier Kurven.
- **Tab „Aufzeichnung“:** CSV-Export für Excel, Energie (Wh) und Ladung (Ah), Kennwerte der ganzen Aufzeichnung und eine Tabelle aller Messpunkte.
- Die Oberfläche ist auf 1920 × 1080 ausgelegt. Ein Demo-Modus funktioniert ohne Gerät.

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

Der Selbsttest startet das Programm unsichtbar im Demo-Modus und klickt sich durch die Portauswahl, den Ausgang, einen Sollwert und die Messfunktion. Dabei prüft er, dass die Live-Seite auf 1920 × 1080 ohne Scrollen passt, und speichert Bilder beider Tabs. Bei einem Fehler endet er mit Exit-Code 1. Er funktioniert auch mit der fertigen .exe.
