'use strict';
/* SPM-26: Messbericht als PDF – Übersicht, Energie, Kennwerte, die vier Kurven über die ganze
   Aufzeichnung, Markierungen, Sollwerte und eine freie Notiz. Die Seite baut das HTML, das Programm
   druckt es mit Chromium zu PDF (keine Zusatzsoftware). Kurven immer in hellen Farben fürs Papier. */

function berichtDialog() {
  if (!zustand.daten.length) { meldung('Die Aufzeichnung ist leer – erst messen, dann den Bericht erstellen.'); return; }
  $('br-info').textContent = `${zustand.daten.length.toLocaleString('de-DE')} Messpunkte von ${uhrzeit(zustand.daten[0].t)} bis ${uhrzeit(zustand.daten.at(-1).t)}.`;
  $('bericht-dialog').showModal();
  $('br-titel').focus();
}

// Kurven der ganzen Aufzeichnung in hell zeichnen, als Bilder abgreifen, Ansicht wiederherstellen –
// alles in einem Rutsch, dazwischen malt der Browser nicht, also flackert nichts
function berichtKurven() {
  const d = zustand.daten, html = document.documentElement;
  const alt = { thema: html.dataset.thema, ansicht: zustand.ansicht, auswahl: zustand.auswahl, hover: zustand.hoverT };
  html.dataset.thema = 'hell';
  zustand.ansicht = [d[0].t, Math.max(d.at(-1).t, d[0].t + 1000)];
  zustand.auswahl = null; zustand.hoverT = null;
  // Fürs Blatt in A4-tauglicher Größe zeichnen, sonst wird die Achsenschrift beim Verkleinern unlesbar
  const stile = KURVEN.map(k => k.canvas.getAttribute('style'));
  for (const k of KURVEN) k.canvas.setAttribute('style', 'width: 900px; height: 220px; flex: none;');
  zeichnen();
  const bilder = KURVEN.map(k => ({ titel: k.box.querySelector('.titel').textContent, farbe: farbe(k.farbe), bild: k.canvas.toDataURL('image/png') }));
  KURVEN.forEach((k, n) => stile[n] === null ? k.canvas.removeAttribute('style') : k.canvas.setAttribute('style', stile[n]));
  html.dataset.thema = alt.thema;
  Object.assign(zustand, { ansicht: alt.ansicht, auswahl: alt.auswahl, hoverT: alt.hover });
  zeichnen();
  return bilder;
}

function berichtHtml(titel, notiz) {
  const e = escapeHtml, d = zustand.daten, st = zustand.statistik;
  const zeile = (name, wert) => `<tr><th>${e(name)}</th><td>${e(wert)}</td></tr>`;
  const beginn = new Date(d[0].t), ende = new Date(d.at(-1).t);
  const kennwerte = [['u', 'Spannung', 'V'], ['i', 'Strom', 'A'], ['p', 'Leistung', 'W'],
    ...Object.keys(st.werte).filter(s => s.startsWith('dmm:')).map(s => [s, 'Multimeter · ' + (FUNKTIONEN[s.slice(4)]?.name ?? s.slice(4)), FUNKTIONEN[s.slice(4)]?.einheit ?? ''])]
    .filter(([s]) => st.werte[s])
    .map(([s, name, ein]) => {
      const w = st.werte[s], f = x => s.startsWith('dmm:') ? mitEinheitText(x, ein) : zahl(x, 3) + ' ' + ein;
      return `<tr><th>${e(name)}</th><td>${e(f(w.min))}</td><td>${e(f(w.max))}</td><td>${e(f(w.summe / w.n))}</td></tr>`;
    }).join('');
  const kurven = berichtKurven().map(k => `<figure><figcaption style="color:${k.farbe}">${e(k.titel)}</figcaption><img src="${k.bild}"></figure>`).join('');
  const marken = $('br-markierungen').checked && zustand.ereignisse.length
    ? `<h2>Markierungen</h2><table class="liste"><tr><th>Zeit</th><th>Text</th></tr>${zustand.ereignisse.map(m => `<tr><td>${e(uhrzeit(m.t))}</td><td>${e(m.text)}</td></tr>`).join('')}</table>` : '';
  const s = zustand.soll;
  const soll = $('br-sollwerte').checked && s
    ? `<h2>Sollwerte am Ende der Aufzeichnung</h2><table class="kv">${zeile('Spannung', zahl(s.volt, 3) + ' V')}${zeile('Strom', zahl(s.curr, 3) + ' A')}${zeile('OVP', zahl(s.ovp, 2) + ' V')}${zeile('OCP', zahl(s.ocp, 2) + ' A')}</table>` : '';
  const geraet = zustand.demo ? 'Demo-Modus (kein echtes Gerät)' : ($('idn').textContent || 'OWON SPM6103');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${e(titel)}</title><style>
    @page { size: A4; margin: 14mm 12mm; }
    body { font: 10.5pt/1.4 "Segoe UI", system-ui, sans-serif; color: #1b2027; margin: 0; }
    h1 { font-size: 18pt; margin: 0 0 2mm; } h2 { font-size: 12pt; margin: 6mm 0 2mm; border-bottom: 1px solid #d6dce4; padding-bottom: 1mm; }
    .unter { color: #5f6b7a; margin-bottom: 4mm; }
    .notiz { white-space: pre-wrap; background: #f6f8fa; border: 1px solid #d6dce4; border-radius: 2mm; padding: 3mm; }
    .spalten { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
    table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 1mm 2mm; border-bottom: 1px solid #e3e8ee; }
    table.kv th { width: 45%; color: #5f6b7a; font-weight: 400; }
    table.kw td, table.kw th:not(:first-child) { text-align: right; font-family: Consolas, monospace; }
    table.liste td:first-child { font-family: Consolas, monospace; width: 22mm; }
    figure { margin: 0 0 3mm; break-inside: avoid; } figcaption { font-weight: 600; margin-bottom: 1mm; }
    figure img { width: 100%; border: 1px solid #e3e8ee; }
    .fuss { margin-top: 6mm; color: #8b95a3; font-size: 8.5pt; }
  </style></head><body>
    <h1>${e(titel)}</h1>
    <div class="unter">${e(beginn.toLocaleDateString('de-DE'))} · ${e(uhrzeit(d[0].t))} bis ${e(uhrzeit(d.at(-1).t))} · ${e(geraet)}</div>
    ${notiz ? `<div class="notiz">${e(notiz)}</div>` : ''}
    <div class="spalten">
      <div><h2>Übersicht</h2><table class="kv">
        ${zeile('Beginn', beginn.toLocaleString('de-DE'))}${zeile('Ende', ende.toLocaleString('de-DE'))}
        ${zeile('Dauer', dauerText((d.at(-1).t - d[0].t) / 1000))}${zeile('Messpunkte', d.length.toLocaleString('de-DE'))}
        ${zeile('Markierungen', String(zustand.ereignisse.length))}</table></div>
      <div><h2>Energie</h2><table class="kv">
        ${zeile('Abgegebene Energie', mitEinheitText(st.energie / 3600, 'Wh'))}${zeile('Abgegebene Ladung', mitEinheitText(st.ladung / 3600, 'Ah'))}
        ${zeile('Ausgang eingeschaltet', dauerText(st.zeitAn))}${zeile('Zeit in CV / CC', `${dauerText(st.zeitCV)} / ${dauerText(st.zeitCC)}`)}</table></div>
    </div>
    <h2>Kennwerte</h2><table class="kw"><tr><th></th><th>Min</th><th>Max</th><th>Mittel</th></tr>${kennwerte}</table>
    <h2>Verlauf</h2>${kurven}
    ${marken}${soll}
    <div class="fuss">Erstellt am ${e(new Date().toLocaleString('de-DE'))} mit OWON SPM6103 ${e(version.installiert ?? '')}</div>
  </body></html>`;
}

async function berichtErstellen() {
  const titel = $('br-titel').value.trim() || 'Messbericht';
  $('br-ok').disabled = true;
  $('br-info').textContent = 'Erstelle PDF …';
  try {
    const name = `${titel.replace(/[^\wäöüÄÖÜß -]+/g, '_').trim() || 'Messbericht'}_${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.pdf`;
    const pfad = await window.spm?.berichtPdf(name, berichtHtml(titel, $('br-notiz').value.trim()));
    if (!pfad) { $('br-info').textContent = 'Nicht gespeichert.'; return; }
    $('bericht-dialog').close();
    log('Messbericht gespeichert: ' + pfad, 'info');
  } catch (e) {
    $('br-info').textContent = 'PDF ließ sich nicht erstellen: ' + e.message;
  } finally {
    $('br-ok').disabled = false;
  }
}

$('bericht').addEventListener('click', berichtDialog);
$('br-abbrechen').addEventListener('click', () => $('bericht-dialog').close());
$('br-ok').addEventListener('click', berichtErstellen);
