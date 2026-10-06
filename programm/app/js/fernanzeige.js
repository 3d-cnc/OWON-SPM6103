'use strict';
/* SPM-27: Fernanzeige im WLAN – das Programm stellt eine kleine Seite im eigenen Netz bereit
   (Webserver im Hauptprogramm, nur mit Zugangscode). Diese Datei liefert ihr zweimal je Sekunde
   die aktuellen Werte und führt „Ausgang aus“ vom Handy aus, wenn das erlaubt ist. */

const neuerCode = () => String(Math.floor(100000 + Math.random() * 900000));
const feEinst = { port: 8080, notaus: false, code: neuerCode(), ...speicher.lesen('fern', {}) };
const fe = { laeuft: false, adressen: [], zuletzt: 0 };
const feMerken = () => speicher.schreiben('fern', feEinst);
feMerken();

function feAnzeigen() {
  $('fe-an').checked = fe.laeuft;
  $('fe-port').value = feEinst.port;
  $('fe-code').value = feEinst.code;
  $('fe-notaus').checked = feEinst.notaus;
  $('fe-port').disabled = fe.laeuft;
  $('menue').classList.toggle('fern', fe.laeuft);
  if (fe.laeuft) chipSetzen('fern', 'Fernanzeige', '', () => feStoppen()); else chipEntfernen('fern');
}

function fernDialog() {
  feAnzeigen();
  $('fern-dialog').showModal();
}

async function feStarten() {
  const port = Math.round(zahlLesen($('fe-port').value));
  if (!(port >= 1024 && port <= 65535)) { $('fe-status').textContent = 'Port zwischen 1024 und 65535 wählen.'; $('fe-an').checked = false; return; }
  feEinst.port = port; feMerken();
  $('fe-status').textContent = 'Starte …';
  const r = await window.spm?.fernStarten({ port, code: feEinst.code, notaus: feEinst.notaus });
  if (!r?.ok) {
    fe.laeuft = false;
    $('fe-status').textContent = 'Lässt sich nicht starten: ' + (r?.fehler ?? 'unbekannt') + (r?.fehler?.includes('EADDRINUSE') ? ' – der Port ist belegt, einen anderen wählen.' : '');
    feAnzeigen();
    return;
  }
  fe.laeuft = true; fe.adressen = r.adressen;
  $('fe-status').textContent = r.adressen.length
    ? 'Läuft. Auf dem Handy im selben WLAN öffnen (oder QR-Code scannen):'
    : 'Läuft, aber der PC hat keine Adresse im lokalen Netz gefunden – ist er mit dem WLAN oder LAN verbunden?';
  $('fe-adressen').innerHTML = r.adressen.map(a => `<a href="#" data-url="${escapeHtml(a)}">${escapeHtml(a)}</a>`).join('');
  $('fe-qr').hidden = !r.qr; if (r.qr) $('fe-qr').src = r.qr;
  $('fe-qr-text').hidden = !!r.qr;
  log(`Fernanzeige läuft: ${r.adressen[0] ?? 'Port ' + port}`, 'info');
  feAnzeigen();
  feSenden(true);
}

async function feStoppen() {
  await window.spm?.fernStoppen();
  fe.laeuft = false;
  $('fe-status').textContent = 'Aus.';
  $('fe-adressen').innerHTML = '';
  $('fe-qr').hidden = true; $('fe-qr-text').hidden = false;
  log('Fernanzeige beendet', 'info');
  feAnzeigen();
}

// Was das Handy sieht: Werte, Zustand und die letzten zwei Minuten als Kurve (höchstens 240 Punkte)
function feSenden(sofort = false) {
  if (!fe.laeuft || !window.spm) return;
  const jetzt = Date.now();
  if (!sofort && jetzt - fe.zuletzt < 500) return;
  fe.zuletzt = jetzt;
  const r = zustand.letzter, d = zustand.daten;
  const ab = ersterIndexAb(d, jetzt - 120000), schritt = Math.max(1, Math.ceil((d.length - ab) / 240));
  const verlauf = [];
  for (let j = ab; j < d.length; j += schritt) verlauf.push([d[j].t, d[j].u, d[j].i]);
  window.spm.fernDaten({
    t: jetzt, verbunden: !!zustand.geraet, demo: zustand.demo,
    u: r?.u, i: r?.i, p: r?.p, modus: r?.modus, ausgang: zustand.ausgang,
    dmm: zustand.dmmAnzeige ? `${zustand.dmmAnzeige.anzeige} ${zustand.dmmAnzeige.einheit}` : null,
    dmmName: FUNKTIONEN[zustand.funktion]?.name ?? null,
    soll: zustand.soll ?? null,
    automatik: [...automatikChips.values()].map(c => c.el.textContent.replace(/Stopp$/, '').trim()),
    alarm: $('alarm-leiste').classList.contains('sichtbar') ? $('alarm-text').textContent : null,
    notaus: feEinst.notaus, verlauf,
  });
}
messHoerer.push(() => feSenden());
setInterval(() => feSenden(), 2000);   // auch ohne Messung (getrennt) den Zustand melden

window.spm?.beiFernBefehl?.(async befehl => {
  if (befehl === 'aus' && feEinst.notaus) {
    await ausgangSchalten(false);
    ereignisSetzen('Fernanzeige: Ausgang vom Handy ausgeschaltet');
    feSenden(true);
  }
});

$('fe-an').addEventListener('change', e => e.target.checked ? feStarten() : feStoppen());
$('fe-notaus').addEventListener('change', async e => {
  feEinst.notaus = e.target.checked; feMerken();
  if (fe.laeuft) await window.spm?.fernStarten({ port: feEinst.port, code: feEinst.code, notaus: feEinst.notaus, nurEinstellungen: true });
  feSenden(true);
});
$('fe-neuer-code').addEventListener('click', async () => {
  feEinst.code = neuerCode(); feMerken();
  if (fe.laeuft) { await feStoppen(); await feStarten(); }
  feAnzeigen();
});
$('fe-adressen').addEventListener('click', e => {
  const a = e.target.closest('a[data-url]');
  if (!a) return;
  e.preventDefault();
  navigator.clipboard?.writeText(a.dataset.url);
  $('fe-status').textContent = 'Adresse kopiert: ' + a.dataset.url;
});
$('fe-schliessen').addEventListener('click', () => $('fern-dialog').close());
feAnzeigen();
