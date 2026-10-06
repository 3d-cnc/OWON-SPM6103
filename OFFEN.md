# Stand und offene Punkte

Stand 06.10.2026: Version 1.0.1 liegt auf `main` und als Release
[v1.0.1](https://github.com/3d-cnc/OWON-SPM6103/releases/tag/v1.0.1) (`OWON-SPM6103.exe`, nicht signiert).
Bisher nur im Demo-Modus und mit dem Selbsttest geprüft (`npx electron . --pruefen=bild.png` in `programm/`).

## Liegt bei Marco

- **Mit dem echten Netzteil ausprobieren:** Verbinden (welcher COM-Port, welche Baudrate findet es),
  Werte im Tab „Live“, Ausgang und Sollwerte setzen, alle Multimeter-Funktionen, CSV speichern.
  Passt etwas nicht: in der SCPI-Konsole „Abfragen mitschreiben“ anhaken und die Ausgabe an Claude geben.

## Offene Vorschläge

Nummern mit dem Vorsatz SPM, damit sie sich nicht mit den Vorschlägen der Webseite überschneiden;
nie neu vergeben. Vergeben sind SPM-1 und SPM-2, **die nächste ist SPM-3**.

| Nr. | Vorschlag |
|---|---|
| SPM-1 | Signieren über den **Microsoft Store**. Das Entwicklerkonto für Privatpersonen ist seit 09/2025 kostenlos (Microsoft-Konto, Ausweis mit Selfie, keine Kreditkarte). Microsoft signiert selbst, es gibt keine SmartScreen-Warnung mehr. Claude baut das Paket mit electron-builder als MSIX/AppX und schreibt die Schritte im Partner Center auf; der Eintrag kann versteckt sein, sodass ihn nur findet, wer den Link hat. Nachteile: jede Version geht durch Microsofts Prüfung, und es gibt eine Store-Installation statt einer losen .exe. |
| SPM-2 | Signieren über die **SignPath Foundation**, kostenlos für Open Source. Bedingungen: Repo öffentlich, Open-Source-Lizenz (z. B. MIT), die .exe baut GitHub Actions automatisch aus dem Repo, eine Download-Seite beschreibt das Programm, SignPath prüft den Antrag. Danach steht „cnc3d.tech“ statt „Unbekannter Herausgeber“; ganz still ist SmartScreen erst, wenn genug Leute die Datei heruntergeladen haben. |

SPM-1 und SPM-2 sind Alternativen; Marco entscheidet. Verworfen, weil nicht kostenlos oder ohne
Nutzen: ein selbst signiertes Zertifikat (SmartScreen warnt trotzdem), Azure Artifact Signing
(9,99 $ im Monat, in der EU nur für Firmen), gekaufte Zertifikate (meist über 100 € im Jahr).
