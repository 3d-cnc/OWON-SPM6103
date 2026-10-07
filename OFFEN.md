# Stand und offene Punkte

Stand 07.10.2026: Version 1.0.1 liegt auf `main` und als Release
[v1.0.1](https://github.com/3d-cnc/OWON-SPM6103/releases/tag/v1.0.1) (`OWON-SPM6103-V1.0.1.exe`, nicht signiert; seit 07.10. steht die Version im Dateinamen).
Selbsttest: `npx electron . --pruefen=bild.png` in `programm/` – spielt seit 1.2.0 auch jede Zusatzfunktion
einmal im Demo-Modus durch (Demo-Last Widerstand, Akku oder LED; das Demo-Multimeter wechselt die Bauteile).

**Am echten Gerät bestätigt** (Marcos Bild vom 06.10., Version 1.0.1): Verbinden klappt, und die
Antworten haben genau das Format aus OWONs Anleitung – `MEAS:ALL:INFO?` liefert sieben Werte
(`0.002 0.000 0.000 0 0 0 0`), `CONF:ALL?` z. B. `VOLT:AC,+231.89V,AUTO,750V`.

**Gerätetest am 07.10. (Firmware FV:V2.1.0, COM3, Ausgang offen):** `npx electron . --geraet=COM3 [--mit-ausgang]`
in `programm/` bedient das Programm am echten Gerät und sammelt jede Fehlermeldung. Bestätigt, auch mit der
fertigen .exe 1.4.2: Verbinden, Messen (3,8/s), Sollwerte, OVP/OCP, Feinverstellung, Vorlagen, alle 8
Messfunktionen mit allen Bereichen, Hold, Alarm auf den Multimeter-Wert, Bauteilprüfung (OL kommt als `OL`),
Fernanzeige mit echten Werten; mit Ausgang (≤ 2 V / 50 mA, nichts angeschlossen): Ausgang ein/aus, Abschalten nach
Zeit, Ablaufprogramm mit Rampe, Erst-Einschalten, Zyklentest, Kennlinie, „Ausgang aus“ über die Fernanzeige.
Eigenheiten des Geräts:
- Bereiche nur in der Schreibweise der Anleitung (`200E-3`, `2`, `20E3` …); `0.2` oder `2000` werden ignoriert.
- Ein fester Bereich schaltet von selbst auf „Manual“; ein `…:RANG:AUTO OFF` direkt davor verschluckt den Bereich.
- Nach Funktions-/Bereichswechsel schaltet das Gerät Relais und antwortet bis ~1 s verzögert; zwei Befehle im
  selben Augenblick (ohne Pause) – der zweite geht verloren. Das Programm wartet deshalb nach Multimeter-Befehlen
  300 ms und auf Antworten bis 1,5 s.
- `OUTP?` und Schutzmeldungen kommen als `ON`/`OFF`, `MEAS:ALL:INFO?` mit Kommas, `MEAS:ALL?` nur mit U und I.
- `…:RANG:NULL?` und `FUNC:VOLT?` antworten `ERR`; ob Relativ wirkt, lässt sich nur am Display sehen.
- Direkt nach dem Einschalten meldet `MEAS:ALL:INFO?` ~0,2 s lang Modus 2 (CC), auch ohne Strom. „Strombegrenzung
  greift“ prüft das Programm deshalb am Strom (≥ 90 % der Grenze), nicht am Modus.
- Gelegentlich antwortet das Gerät auf `MEAS:ALL:INFO?` mit `ERR` – einzelne Aussetzer stehen grau im Log.
- Widerstand ohne Bauteil (OL): im Automatikbetrieb springt das Gerät zwischen den Bereichen; ein fester Bereich
  landet dann manchmal eine Stufe zu hoch. Das Programm liest den Bereich nach 1,5 s zurück und setzt ihn notfalls neu.
- Einmal blieb ein `OUTP OFF` ohne Wirkung (nicht nachstellbar). Das Programm liest den Ausgang nach jedem Schalten
  zurück und schickt den Befehl bis zu dreimal.
- Die Display-Taste schaltet reihum durch vier Ansichten: 1 Netzteil mit Kurve (nach dem Einschalten),
  2 nur Multimeter, 3 Multimeter oben und Netzteil unten, 4 Netzteil groß. `FUNC:…` wechselt die Messfunktion
  sofort, zu sehen ist das aber nur in Ansicht 2 und 3 (am 07.10. mit Marco geprüft). Die Ansicht lässt sich nicht
  abfragen, `SIM:KEY:DISP` schaltet sie nur eine weiter. Dafür gibt es den Knopf „Display umschalten“.

**Versionsprüfung (seit 1.1.0):** Das Programm fragt `api.github.com/repos/3d-cnc/OWON-SPM6103/releases/latest`.
Solange das Repo privat ist, antwortet GitHub mit 404, und das Symbol neben der Version bleibt grau
(„Prüfung nicht möglich“). Sobald das Repo öffentlich ist, wird es ohne weitere Änderung grün oder rot.
Neue Version = höhere `version` in `programm/package.json` und ein Release mit dem Tag `v` + Version.

## Liegt bei Marco

- **Noch nie mit echter Last geprüft:** CV/CC unter Last, Kennlinie an einer echten LED, Akku laden an einem echten
  Akku, Alarme und Abschalten bei fließendem Strom. Passt etwas nicht: in der SCPI-Konsole „Abfragen mitschreiben“
  anhaken und die Ausgabe an Claude geben.
- **Fernanzeige mit dem echten Handy:** einschalten, Windows-Firewall „Zugriff zulassen“ (private Netzwerke),
  QR-Code scannen. Geprüft ist sie bisher nur auf demselben PC (127.0.0.1).
- **Entschieden (06.10.):** Die Fernanzeige bleibt bei http; „Nicht sicher“ im Handy-Browser nimmt Marco
  in Kauf (Variante A). Verworfen: selbst erstelltes Zertifikat (große Warnseite statt kleinem Hinweis)
  und echtes Let's-Encrypt-Zertifikat über eine Subdomain von cnc3d.tech (DNS-Eintrag auf die Adresse im
  Heimnetz, Ausnahme gegen DNS-Rebinding in der Fritz!Box, Verlängerung alle 90 Tage, nur für Marco nutzbar).
- **Relativ am Display prüfen:** ob „Relativ“ den Wert am Gerät wirklich auf null setzt.

## Umgesetzt

- 07.10., Version 1.0.1: Knopf **„Display umschalten“** im Multimeter-Feld (`SIM:KEY:DISP`). Marco war aufgefallen,
  dass das Display beim Umschalten der Messfunktion nicht mitwechselt: Es stand auf einer Netzteil-Ansicht.
  Dazu **Starten/Beenden** auf „Aufzeichnung“ (Marco): Die Aufzeichnung beginnt nicht mehr beim Verbinden. Die Kurven
  auf „Live“ haben einen eigenen Puffer (`zustand.live`, höchstens 200 000 Punkte) und laufen immer; aufgezeichnet
  wird in `zustand.daten` nur bei `zustand.aufzeichnet`. Trennen beendet die Aufzeichnung. Laufend speichern: eine
  Sitzungsdatei bleibt bei „Beenden“ offen („pausiert“), eine Datei je Ausgang wird abgeschlossen. Release 1.0.1
  blieb (Marco), nur die .exe darin ersetzt.
- 07.10.: **Neue Zählung** (Marco): alle bisherigen Releases und Tags (v1.0.0 bis v1.4.2) auf GitHub gelöscht,
  der Stand von 1.4.2 heißt jetzt **1.0.0**. Die Versionsnummern in den Einträgen darunter sind die alte Zählung.
  Dazu fünf Hinweistexte aus der Oberfläche entfernt (Laufend speichern, Aufzeichnung, Energie, Abschalten, Alarme).
- 06.10., Version 1.2.0: **SPM-10 bis SPM-19** (Vorlagen, Abschalten, Alarme, Ablaufprogramm, Akku laden,
  Kennlinie, laufend speichern, Markierungen, Vergleich, Bauteilprüfung). Neue Tabs „Automatik“,
  „Kennlinie“, „Bauteile“, „Vergleich“; der Code der Zusatzfunktionen liegt in `programm/app/js/`.
  Alles nur im Demo-Modus geprüft.
- 06.10., Version 1.3.0: **Hell/Dunkel** zum Umschalten (Knopf oben rechts, Menü, Strg+Umschalt+L), Vorgabe
  dunkel, unabhängig von Windows; gespeichert. Damit ist der Teil „Hell/Dunkel“ aus SPM-6 erledigt.
- 07.10., Version 1.4.2: **Gerätetest mit Ausgang** – Erst-Einschalten und Kennlinie hielten die kurze CC-Meldung
  nach dem Einschalten für eine Strombegrenzung (jetzt am Strom geprüft); Ausgang wird nach dem Schalten
  zurückgelesen und notfalls erneut geschaltet; Messbereich wird zurückgelesen und notfalls neu gesetzt, eine neue
  Wahl beendet die Prüfung der vorigen; einzelne Aussetzer grau, Fehlermeldungen mit der Antwort des Geräts;
  `MEAS:ALL?` mit nur U und I wird verstanden.
- 07.10., Version 1.4.1: **Fehler vom echten Gerät behoben** – 200 mV/200 mA ließen sich nicht wählen (`0.2` statt
  `200E-3`), der erste Bereichswechsel aus „Automatisch“ ging verloren, „Keine Antwort auf CONF:ALL?“ nach
  Bereichswechseln; Anzeige ohne führende Nullen („0,000 A“). Neu: Gerätetest `--geraet=COM3`.
- 06.10., Version 1.4.0: **SPM-22 bis SPM-27** – Feinverstellung per Mausrad, neuer Tab „Prüfstand“ mit
  Erst-Einschalten und Zyklentest, Verlauf zoomen/verschieben/Ausschnitt und Kurven als Bild, Messbericht
  als PDF, Fernanzeige im WLAN (Webserver in `main.js`, Seite `programm/fern/index.html`, npm-Paket
  `qrcode`). Nur im Demo-Modus bzw. auf demselben PC geprüft.

## Offene Vorschläge

Nummern mit dem Vorsatz SPM, damit sie sich nicht mit den Vorschlägen der Webseite überschneiden;
nie neu vergeben. Vergeben sind SPM-1 bis SPM-29, **die nächste ist SPM-30**.

| Nr. | Vorschlag |
|---|---|
| SPM-1 | Signieren über den **Microsoft Store**. Das Entwicklerkonto für Privatpersonen ist seit 09/2025 kostenlos (Microsoft-Konto, Ausweis mit Selfie, keine Kreditkarte). Microsoft signiert selbst, es gibt keine SmartScreen-Warnung mehr. Claude baut das Paket mit electron-builder als MSIX/AppX und schreibt die Schritte im Partner Center auf; der Eintrag kann versteckt sein, sodass ihn nur findet, wer den Link hat. Nachteile: jede Version geht durch Microsofts Prüfung, und es gibt eine Store-Installation statt einer losen .exe. |
| SPM-2 | Signieren über die **SignPath Foundation**, kostenlos für Open Source. Bedingungen: Repo öffentlich, Open-Source-Lizenz (z. B. MIT), die .exe baut GitHub Actions automatisch aus dem Repo, eine Download-Seite beschreibt das Programm, SignPath prüft den Antrag. Danach steht „cnc3d.tech“ statt „Unbekannter Herausgeber“; ganz still ist SmartScreen erst, wenn genug Leute die Datei heruntergeladen haben. |
| SPM-3 | **Update mit einem Klick:** „Update herunterladen“ lädt die neue .exe im Programm herunter (mit Fortschrittsbalken), prüft die Größe, ersetzt nach einer Rückfrage die alte Datei und startet neu. Alternative: eine Installer-Fassung mit electron-updater, die Updates selbst im Hintergrund einspielt. Beides braucht das öffentliche Repo. |
| SPM-4 | **Update-Hinweis mit Maß:** „Diese Version überspringen“ und „Später erinnern“. Bei Dauermessungen über viele Stunden prüft das Programm höchstens einmal am Tag nach, auch wenn es die ganze Zeit läuft. |
| SPM-5 | **Oberfläche skalieren** (80–150 %) im Menü, gespeichert. Dann bleibt die 1920 × 1080-Anordnung bei jeder Fenstergröße gleich und wird nur verkleinert oder vergrößert, statt sich umzuordnen – etwa auf einem 4K-Bildschirm oder auf 1600 × 900. Strg + / Strg − gehen schon heute, werden aber nicht gemerkt. |
| SPM-6 | **Menü erweitern:** Einstellungen (Trennzeichen und Dezimalzeichen der CSV, Abfragetakt beim Start), Hilfe (öffnet LIESMICH), „Über“ mit Lizenz und Links. (Hell/Dunkel seit 1.3.0 erledigt, Speicherordner gibt es im laufenden Speichern.) |
| SPM-7 | **Für die Veröffentlichung vorbereiten:** Lizenz (z. B. MIT), englische Oberfläche mit Sprachwahl im Menü, README auf Englisch mit Bildern, CHANGELOG. Die .exe baut GitHub Actions bei jedem neuen Versions-Tag selbst (passt zu SPM-2). OWONs PDF bleibt draußen. |
| SPM-8 | **Veröffentlichen in einem Schritt:** `npm run veroeffentlichen` erhöht die Version, baut, führt den Selbsttest aus, setzt den Tag und lädt das Release mit Notizen hoch – weniger Handarbeit und keine vergessene Versionsnummer, auf die sich die Versionsprüfung verlässt. |

### Veröffentlichen

| Nr. | Vorschlag |
|---|---|
| SPM-9 | **Repo öffentlich schalten** (Marco, 06.10.: „kann auf die Todo-Liste“). Am 06.10. geprüft: Im Verlauf liegen weder OWONs PDF noch eine .exe noch Passwörter oder Schlüssel. Sinnvoll vorher: SPM-7 (Lizenz, README). Dann `gh repo edit 3d-cnc/OWON-SPM6103 --visibility public --accept-visibility-change-consequences`. Ab da funktioniert die Versionsprüfung (graues Symbol wird grün/rot), und SPM-2 und SPM-3 werden möglich. |

### Weitere Funktionen (Vorschläge vom 06.10., nach 1.3.0)

| Nr. | Vorschlag |
|---|---|
| SPM-20 | **Von selbst wieder verbinden:** den zuletzt benutzten COM-Port merken, auf Wunsch beim Start gleich verbinden, und nach einem USB-Abriss oder Aus- und Einschalten des Netzteils selbst neu verbinden – die Aufzeichnung läuft in derselben Sitzung weiter, die Lücke wird markiert. |
| SPM-21 | **Schleppzeiger und Glättung im Tab Live:** unter jedem großen Wert Min und Max seit dem letzten Zurücksetzen (z. B. höchster Strom beim Einschalten eines Motors), dazu wahlweise ein gleitender Mittelwert über 4, 10 oder 50 Messungen gegen unruhige Anzeigen. |
| SPM-28 | **Benachrichtigung aufs Handy:** bei Alarm, Abschaltung oder „Akku voll“ eine Nachricht aufs Handy, etwa über ntfy (kostenlose App, kein Konto nötig) oder per E-Mail. Nur wenn eingeschaltet; übertragen wird nur der Meldungstext. |
| SPM-29 | **Rechenkanal mit eigener Formel:** eine zusätzliche Kurve und CSV-Spalte aus U, I, P und dem Multimeter-Wert, z. B. Widerstand = U/I, Wirkungsgrad mit bekannter Last, oder **Temperatur aus einem NTC** am Multimeter (Ω → °C nach Datenblatt-B-Wert). Mit Einheit und eigenem Namen; Alarme und Abschalten können ihn ebenfalls nutzen. |

Offen aus dieser Reihe: SPM-20, SPM-21, SPM-28, SPM-29 (SPM-22 bis SPM-27 umgesetzt in 1.4.0).

SPM-1 und SPM-2 sind Alternativen; Marco entscheidet. Verworfen, weil nicht kostenlos oder ohne
Nutzen: ein selbst signiertes Zertifikat (SmartScreen warnt trotzdem), Azure Artifact Signing
(9,99 $ im Monat, in der EU nur für Firmen), gekaufte Zertifikate (meist über 100 € im Jahr).
Wortlaut der umgesetzten Vorschläge SPM-10 bis SPM-19 und SPM-22 bis SPM-27: `git log -p OFFEN.md`.
