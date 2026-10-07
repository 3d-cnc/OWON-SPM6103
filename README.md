# OWON SPM6103

Windows-Programm, das Messwerte des Labornetzteils mit Multimeter **OWON SPM6103** live anzeigt und aufzeichnet. Es spricht über USB (CH340, SCPI) direkt mit dem Gerät und läuft als einzelne portable .exe.

- **Tab „Live“:** Spannung, Strom und Leistung, CV/CC, Schutzmeldungen, Ausgang, Sollwerte (auch per Mausrad wie am Drehknopf) und Sollwert-Vorlagen. Dazu der Multimeter-Wert mit Wahl der Messfunktion und des Messbereichs, ein Knopf für die Display-Taste des Geräts (die Messfunktion zeigt das Gerät nur in seiner zweiten und dritten Ansicht), eine SCPI-Konsole, vier Kurven zum Zoomen und Verschieben mit Ausschnitt-Auswertung, Kurven als Bild, Markierungen mit Notiz (Taste M).
- **Tab „Aufzeichnung“:** Starten und Beenden (aufgezeichnet wird nicht schon ab dem Verbinden), CSV-Export für Excel, laufendes Speichern während der Messung, Messbericht als PDF, Energie (Wh) und Ladung (Ah), Kennwerte der ganzen Aufzeichnung und eine Tabelle aller Messpunkte.
- **Tab „Automatik“:** Abschalten nach Zeit, Wh, mAh oder bei kleinem Strom; Grenzwerte mit Alarm; Ablaufprogramme mit Rampen; Akku laden (Li-Ion, LiHV, LiFePO4, Blei, NiMH).
- **Tab „Prüfstand“:** Erst-Einschalten neuer Platinen (langsam hochfahren, bei Auffälligkeit sofort aus, Ruhestrom prüfen) und Zyklentest mit Fehlererkennung.
- **Tab „Kennlinie“:** U-I-Kennlinien aufnehmen, etwa von LEDs, Dioden oder Motoren, mehrere Kurven im Vergleich.
- **Tab „Bauteile“:** Bauteile mit dem Multimeter prüfen (Gut/Schlecht, Zähler, Protokoll).
- **Tab „Vergleich“:** gespeicherte Aufzeichnungen und die aktuelle übereinanderlegen.
- **Menü:** Nach Updates suchen, Fenstergröße beim Start (Vorgabe 1920 × 1080), Messbericht als PDF, Fernanzeige im WLAN, Hell/Dunkel und Beenden.
- **Fernanzeige:** kleine Webseite fürs Handy im eigenen WLAN (QR-Code), nur mit Zugangscode, wahlweise mit „Ausgang aus“.
- **Design:** dunkel als Vorgabe, hell per Knopf oben rechts (Mond/Sonne) oder Strg+Umschalt+L; die Wahl bleibt gespeichert.
- **Versionsprüfung:** Neben dem Namen stehen die Version und ein Symbol. Es ist grün, wenn das Programm aktuell ist, rot, wenn es ein Update gibt, und grau, wenn sich das nicht prüfen lässt. Gefragt wird nach dem neuesten GitHub-Release dieses Repositorys.
- Ein Demo-Modus funktioniert ohne Gerät.

Bedienung und Fehlersuche: [LIESMICH.txt](LIESMICH.txt). Stand und offene Punkte: [OFFEN.md](OFFEN.md).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `programm/app/index.html` | Oberfläche und Gerätelogik (Web Serial, SCPI, Kurven, Aufzeichnung, Demo-Gerät) |
| `programm/app/js/` | Zusatzfunktionen, je eine Datei: Vorlagen, Markierungen, Überwachung (Abschalten, Alarme), Ablauf, Akku, Kennlinie, laufend speichern, Vergleich, Bauteile, Feinverstellung, Prüfstand, Verlauf (Zoom, Bild), Bericht, Fernanzeige; gemeinsame Bausteine in `gemeinsam.js` |
| `programm/fern/index.html` | Seite der Fernanzeige fürs Handy (liefert der Webserver in `main.js`) |
| `programm/app/funktionen.css` | Aussehen der Zusatzfunktionen |
| `programm/main.js` | Electron-Hülle: Fenster 1920 × 1080, Auswahl des COM-Ports, Speicherdialoge, PDF-Druck, Webserver der Fernanzeige, Selbsttest |
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

`npm run bauen` legt die .exe mit der Version im Namen in den obersten Ordner, z. B. `OWON-SPM6103-V1.0.1.exe`. Die .exe selbst ist nicht im Repository.

## Selbsttest

```
cd programm
npx electron . --pruefen=bild.png
```

Der Selbsttest startet das Programm in einem durchsichtigen Fenster im Demo-Modus und klickt sich durch die Portauswahl, den Ausgang, einen Sollwert und die Messfunktion. Er prüft:
- dass die Live-Seite auf 1920 × 1080 ohne Scrollen passt,
- dass viele Konsolen-Einträge den Verlauf nicht zusammendrücken,
- den Versionsvergleich, die Versionsprüfung, das Menü und den Update-Hinweis,
- dass ein Wechsel der Fenstergröße auf 1600 × 900 sofort gilt und gespeichert wird,
- dass Dunkel die Vorgabe ist und der Wechsel auf Hell wirkt und gespeichert wird (mit Bildern einiger Tabs in Hell),
- jede Zusatzfunktion einmal echt: Vorlage, Markierung, Alarm mit Abschalten, Abschalten nach Zeit, Ablauf mit Rampe, Kennlinie an der Demo-LED, Ladung des Demo-Akkus bis „voll“, Bauteilprüfung, laufendes Speichern und Laden der Datei im Vergleich,
- Feinverstellung (auch die Grenze an OVP), Erst-Einschalten (einmal in Ordnung, einmal Abbruch), Zyklentest (in Ordnung und mit Fehler), Zoomen und Ausschnitt im Verlauf, Bild speichern und kopieren, Messbericht als PDF (mit Bild der Berichtsseite), Fernanzeige (Code nötig, Daten, „Ausgang aus“ nur wenn erlaubt, Sperre nach falschen Codes, Bild der Handy-Seite).

Dabei speichert er Bilder der Tabs, des Menüs und der Dialoge. Bei einem Fehler endet er mit Exit-Code 1. Er funktioniert auch mit der fertigen .exe.

## Gerätetest am echten Netzteil

```
cd programm
npx electron . --geraet=COM3 --pruefen=bild.png
```

Verbindet sich ohne Dialog mit dem angegebenen Port und bedient das Programm am echten Gerät:
- Sollwerte, Feinverstellung und Vorlagen,
- jede Messfunktion mit jedem Bereich,
- Hold, Relativ, Alarm, Bauteilprüfung und Fernanzeige.

Jede Fehlermeldung aus dem Log landet im Ergebnis, das ganze Log in `geraet-log.txt` neben dem Bild. Ohne `--mit-ausgang` bleibt der Ausgang aus; ist er bei Testbeginn an, bricht der Test ab, ohne etwas zu ändern. Mit `--mit-ausgang` kommen Ausgang, Abschalten, Ablauf, Erst-Einschalten, Zyklentest, Kennlinie und „Ausgang aus“ über die Fernanzeige dazu, mit höchstens 2 V und 50 mA. Am Ende stellt der Test die vorherigen Sollwerte wieder her.
