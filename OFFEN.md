# Stand und offene Punkte

Stand 06.10.2026: Version 1.3.0 liegt auf `main` und als Release
[v1.3.0](https://github.com/3d-cnc/OWON-SPM6103/releases/tag/v1.3.0) (`OWON-SPM6103.exe`, nicht signiert).
Selbsttest: `npx electron . --pruefen=bild.png` in `programm/` – spielt seit 1.2.0 auch jede Zusatzfunktion
einmal im Demo-Modus durch (Demo-Last Widerstand, Akku oder LED; das Demo-Multimeter wechselt die Bauteile).

**Am echten Gerät bestätigt** (Marcos Bild vom 06.10., Version 1.0.1): Verbinden klappt, und die
Antworten haben genau das Format aus OWONs Anleitung – `MEAS:ALL:INFO?` liefert sieben Werte
(`0.002 0.000 0.000 0 0 0 0`), `CONF:ALL?` z. B. `VOLT:AC,+231.89V,AUTO,750V`.

**Versionsprüfung (seit 1.1.0):** Das Programm fragt `api.github.com/repos/3d-cnc/OWON-SPM6103/releases/latest`.
Solange das Repo privat ist, antwortet GitHub mit 404, und das Symbol neben der Version bleibt grau
(„Prüfung nicht möglich“). Sobald das Repo öffentlich ist, wird es ohne weitere Änderung grün oder rot.
Neue Version = höhere `version` in `programm/package.json` und ein Release mit dem Tag `v` + Version.

## Liegt bei Marco

- **Am echten Netzteil noch ausprobieren:** Ausgang ein/aus, Sollwerte und OVP/OCP setzen, CV/CC unter
  Last, die übrigen Multimeter-Funktionen, Messbereich, Hold und Relativ, CSV speichern.
  Passt etwas nicht: in der SCPI-Konsole „Abfragen mitschreiben“ anhaken und die Ausgabe an Claude geben.
  Davon hängen Vorlagen, Abschalten, Alarme mit Abschalten, Ablaufprogramm, Akku laden und Kennlinie ab:
  sie alle setzen `VOLT`, `CURR`, `VOLT:LIM`, `CURR:LIM` und `OUTP`.
- **Bauteilprüfung am echten Multimeter:** Wie meldet das SPM6103 „nichts angeschlossen“ in `CONF:ALL?`
  (Anzeige OL)? Das Programm erwartet einen Wert, der keine Zahl ist. Kommt stattdessen eine sehr große
  Zahl, zählt die Prüfung nicht von selbst weiter – dann die Konsolen-Ausgabe an Claude geben.

## Umgesetzt

- 06.10., Version 1.2.0: **SPM-10 bis SPM-19** (Vorlagen, Abschalten, Alarme, Ablaufprogramm, Akku laden,
  Kennlinie, laufend speichern, Markierungen, Vergleich, Bauteilprüfung). Neue Tabs „Automatik“,
  „Kennlinie“, „Bauteile“, „Vergleich“; der Code der Zusatzfunktionen liegt in `programm/app/js/`.
  Alles nur im Demo-Modus geprüft.
- 06.10., Version 1.3.0: **Hell/Dunkel** zum Umschalten (Knopf oben rechts, Menü, Strg+Umschalt+L), Vorgabe
  dunkel, unabhängig von Windows; gespeichert. Damit ist der Teil „Hell/Dunkel“ aus SPM-6 erledigt.

## Offene Vorschläge

Nummern mit dem Vorsatz SPM, damit sie sich nicht mit den Vorschlägen der Webseite überschneiden;
nie neu vergeben. Vergeben sind SPM-1 bis SPM-19, **die nächste ist SPM-20**.

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

SPM-1 und SPM-2 sind Alternativen; Marco entscheidet. Verworfen, weil nicht kostenlos oder ohne
Nutzen: ein selbst signiertes Zertifikat (SmartScreen warnt trotzdem), Azure Artifact Signing
(9,99 $ im Monat, in der EU nur für Firmen), gekaufte Zertifikate (meist über 100 € im Jahr).
Wortlaut der umgesetzten Vorschläge SPM-10 bis SPM-19: `git log -p OFFEN.md`.
