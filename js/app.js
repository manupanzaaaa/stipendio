/* Interfaccia dell'app: calendario, busta, storico, impostazioni. */
(function () {
  'use strict';
  const M = window.Motore;
  const CHIAVE = 'calcoloStipendio.dati.v1';
  const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  const GIORNI_BREVI = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const COLORI = { ufficio: '--t-ufficio', trasferta: '--t-trasferta', piattaforma: '--t-piattaforma', formazione: '--t-formazione', ferie: '--t-ferie', permesso: '--t-permesso', malattia: '--t-malattia', festivita: '--t-festivita', riposo: '--t-riposo' };
  const ETICHETTE_BREVI = { ufficio: 'Ufficio', trasferta: 'Trasf.', piattaforma: 'Piattaf.', formazione: 'Formaz.', ferie: 'Ferie', permesso: 'Permesso', malattia: 'Malattia', festivita: 'Festa', riposo: '' };
  const SIGLE = { base: 'B', media: 'M', piena: 'P' };
  const isT = (t) => M.inTrasferta(t);
  const NOTTI = { piattaforma: 'notte in piattaforma', hotel: 'notte in hotel', casa: 'rientro a casa' };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) => (n == null || isNaN(n) ? '—' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }));
  const num = (n, d = 2) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: d });
  const dataIt = (s) => s.split('-').reverse().join('/');
  const oggiIso = () => { const d = new Date(); return M.iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); };

  /* ---------------- Stato e salvataggio ---------------- */
  let dati = carica();
  const oggi = new Date();
  let anno = oggi.getFullYear(), mese = oggi.getMonth() + 1, annoStorico = anno;
  let vista = 'calendario';
  let giornoAperto = null;

  function carica() {
    try {
      const raw = localStorage.getItem(CHIAVE);
      if (raw) {
        const d = JSON.parse(raw);
        return { giorni: d.giorni || {}, mesi: d.mesi || {}, impostazioni: d.impostazioni || null, meta: d.meta || {} };
      }
    } catch (e) { /* storage non disponibile */ }
    return { giorni: {}, mesi: {}, impostazioni: null, meta: {} };
  }
  function salva() {
    try { localStorage.setItem(CHIAVE, JSON.stringify(dati)); } catch (e) { toast('Attenzione: impossibile salvare i dati in questo browser.'); }
  }
  const imp = () => M.normalizzaImpostazioni(dati.impostazioni);
  function impModificabili() {
    if (!dati.impostazioni) dati.impostazioni = M.clona(imp());
    else dati.impostazioni = M.normalizzaImpostazioni(dati.impostazioni);
    return dati.impostazioni;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function applicaAspetto() {
    const a = imp().aspetto;
    const r = document.documentElement;
    if (a.tema === 'chiaro') r.setAttribute('data-theme', 'light');
    else if (a.tema === 'scuro') r.setAttribute('data-theme', 'dark');
    else r.removeAttribute('data-theme');
    r.setAttribute('data-testo', a.testo || 'normale');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(r).getPropertyValue('--primario').trim() || '#1f5f8b';
  }

  /* ---------------- Calcolo ---------------- */
  const cache = new Map();
  function calcola(y, m) {
    const k = `${y}-${m}`;
    if (!cache.has(k)) cache.set(k, M.calcolaMese(y, m, dati, imp()));
    return cache.get(k);
  }
  const invalida = () => cache.clear();

  /* ---------------- Rendering generale ---------------- */
  function render() {
    applicaAspetto();
    const r = calcola(anno, mese);
    $('#titoloMese').textContent = `${MESI[mese - 1]} ${anno}`;
    $('#lordo').textContent = eur(r.totali.lordo);
    $('#netto').textContent = eur(r.totali.netto);
    $('#accredito').textContent = dataIt(r.accredito).slice(0, 5);
    document.querySelectorAll('.schede button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vista === vista)));
    document.querySelectorAll('.vista').forEach((s) => { s.hidden = s.id !== `vista-${vista}`; });
    renderBanner();
    if (vista === 'calendario') renderCalendario(r);
    if (vista === 'busta') renderBusta(r);
    if (vista === 'storico') renderStorico();
    if (vista === 'impostazioni') renderImpostazioni();
  }

  function renderBanner() {
    const b = $('#bannerAvvio');
    if (!dati.impostazioni) {
      b.hidden = false;
      b.innerHTML = `<strong>Benvenuto!</strong> Per calcoli precisi imposta i dati della tua busta paga (paga base, apprendistato, addizionali)
        oppure importa un file di profilo o di backup.<br>
        <button class="btn primario" data-azione="vai-imp">Apri impostazioni</button>
        <button class="btn" data-azione="importa">Importa profilo/backup</button>`;
      return;
    }
    const giorniMem = Object.keys(dati.giorni).length;
    const ogni = Number(imp().backup.promemoriaGiorni || 0);
    const ultimo = dati.meta.ultimoBackup ? new Date(dati.meta.ultimoBackup) : null;
    if (ogni > 0 && giorniMem > 5 && (!ultimo || (Date.now() - ultimo) / 86400000 > ogni)) {
      b.hidden = false;
      b.innerHTML = `I dati sono salvati solo in questo browser. ${ultimo ? `Ultimo backup: ${ultimo.toLocaleDateString('it-IT')}.` : 'Non hai ancora fatto un backup.'}
        <br><button class="btn primario" data-azione="esporta">Scarica backup</button>`;
      return;
    }
    b.hidden = true;
  }

  /* ---------------- Calendario ---------------- */
  function renderCalendario(r) {
    const i = imp();
    const primo = Number(i.aspetto.primoGiorno);
    const ordine = [0, 1, 2, 3, 4, 5, 6].map((x) => (x + primo) % 7);
    $('#calIntestazione').innerHTML = ordine.map((g) => `<div>${GIORNI_BREVI[g]}</div>`).join('');
    const gm = M.giorniNelMese(anno, mese);
    const inizio = M.giornoSettimana(M.iso(anno, mese, 1));
    const vuoti = (inizio - primo + 7) % 7;
    const oggi = oggiIso();
    let html = '';
    for (let k = 0; k < vuoti; k++) html += '<div class="giorno vuoto-mese"></div>';
    for (let d = 1; d <= gm; d++) {
      const data = M.iso(anno, mese, d);
      const rec = dati.giorni[data];
      const tipo = M.tipoGiorno(data, dati.giorni, i);
      const gs = M.giornoSettimana(data);
      const fest = M.festivita(data, i);
      const cls = ['giorno'];
      if (gs === 0 || gs === 6 || fest) cls.push('weekend');
      if (data === oggi) cls.push('oggi');
      if (!tipo) cls.push('da-compilare');
      let etichetta = tipo ? ETICHETTE_BREVI[tipo] : '—';
      let breve = etichetta;
      if (tipo === 'trasferta') { etichetta += rec.regione === 'fuori' ? ' fuori' : ' in reg.'; breve = rec.regione === 'fuori' ? 'Fuori' : 'In reg.'; }
      if (tipo === 'festivita' && !rec) { etichetta = fest || 'Festa'; breve = 'Festa'; }
      if (tipo === 'piattaforma') { etichetta = 'Piattaforma'; breve = 'Piatt.'; }
      if (tipo === 'malattia') breve = 'Malatt.';
      if (tipo === 'permesso') breve = 'Perm.';
      let badge = '', extra = '', catena = '';
      if (isT(tipo) && r.trasferte[data]) {
        const c = r.trasferte[data];
        badge = `<span class="badge ${c.codice}" title="${c.continuativa ? 'Continuativa' : 'Non continuativa'}">${SIGLE[c.codice]}</span>`;
        catena = '<span class="catena"></span>';
      }
      if (rec && (tipo === 'ufficio' || isT(tipo))) {
        const turno = isT(tipo) ? i.orari.turnoTrasferta : i.orari.turnoUfficio;
        const min = rec.minuti != null ? rec.minuti : turno * 60;
        const lavorativo = !(gs === 0 || gs === 6 || fest);
        const str = lavorativo ? M.oreStraordinario(min, turno, i.orari.bloccoMinuti) : min / 60;
        const parti = [`${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`];
        if (str > 0) parti.push(lavorativo ? `+${num(str)} str.` : 'magg.');
        const s = rec.spese || {};
        if (['colazione', 'pranzo', 'cena', 'hotel'].some((k) => s[k] && s[k].r)) parti.push('€');
        if (tipo === 'piattaforma' && rec.pernotto && rec.pernotto !== 'casa') parti.push(rec.pernotto === 'hotel' ? '🏨' : '🌙');
        extra = `<span class="extra">${parti.join(' · ')}</span>`;
      }
      if (rec && rec.permessoOre && tipo !== 'permesso') extra += `<span class="extra">perm. ${num(rec.permessoOre)}h</span>`;
      const colore = tipo ? `var(${COLORI[tipo]})` : 'transparent';
      html += `<button type="button" class="${cls.join(' ')}" style="--colore-tipo:${colore}" data-data="${data}" aria-label="${d} ${MESI[mese - 1]}: ${esc(etichetta)}">
        <span class="num">${d}</span><span class="tipo"><span class="lungo">${esc(etichetta)}</span><span class="breve">${esc(breve)}</span></span>${extra}${badge}${catena}</button>`;
    }
    $('#calendario').innerHTML = html;
    $('#legenda').innerHTML = Object.keys(M.TIPI).filter((t) => t !== 'riposo')
      .map((t) => `<span style="--c:var(${COLORI[t]})">${M.TIPI[t].nome}</span>`).join('') +
      '<span style="--c:#a86412">B = Base</span><span style="--c:#d27a12">M = Media</span><span style="--c:#1d7a46">P = Piena</span>';
    $('#avvisiCal').innerHTML = r.avvisi.map((a) => `<div class="avviso">${esc(a)}</div>`).join('');
  }

  /* ---------------- Dialogo del giorno ---------------- */
  const TIPI_DIALOGO = ['ufficio', 'trasferta', 'piattaforma', 'formazione', 'ferie', 'permesso', 'malattia', 'festivita', 'riposo'];
  function apriGiorno(data) {
    giornoAperto = data;
    const i = imp();
    const rec = dati.giorni[data] || {};
    const [y, m, d] = data.split('-').map(Number);
    const gs = M.giornoSettimana(data);
    const fest = M.festivita(data, i);
    $('#titoloGiorno').textContent = `${['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'][gs]} ${d} ${MESI[m - 1]} ${y}${fest ? ' · ' + fest : ''}`;
    const tipoAtt = rec.tipo || M.tipoGiorno(data, dati.giorni, i) || 'ufficio';
    $('#sceltaTipo').innerHTML = '<legend class="aiuto">Tipo di giornata</legend>' + TIPI_DIALOGO.map((t) =>
      `<label style="--c:var(${COLORI[t]})"><input type="radio" name="tipo" value="${t}" ${t === tipoAtt ? 'checked' : ''}>${M.TIPI[t].nome}</label>`).join('');
    document.querySelector(`input[name="regione"][value="${rec.regione === 'fuori' ? 'fuori' : 'in'}"]`).checked = true;
    document.querySelector(`input[name="pernotto"][value="${rec.pernotto || 'piattaforma'}"]`).checked = true;
    const turno = isT(tipoAtt) ? i.orari.turnoTrasferta : i.orari.turnoUfficio;
    const min = rec.minuti != null ? rec.minuti : turno * 60;
    $('#ore').value = Math.floor(min / 60);
    $('#minuti').value = String(min % 60);
    $('#ore').dataset.toccato = rec.minuti != null ? '1' : '';
    const s = rec.spese || {};
    for (const [k, id] of [['colazione', 'Colazione'], ['pranzo', 'Pranzo'], ['cena', 'Cena'], ['hotel', 'Hotel']]) {
      $(`#r${id}`).checked = !!(s[k] && s[k].r);
      $(`#i${id}`).value = s[k] && s[k].importo ? s[k].importo : '';
    }
    $('#permessoOre').value = rec.permessoOre || '';
    $('#nota').value = rec.nota || '';
    $('#copiaFino').value = '';
    $('#copiaFino').min = M.aggiungiGiorni(data, 1);
    $('#copiaWeekend').checked = false;
    document.querySelector('.copia').open = false;
    aggiornaDialogo();
    $('#dialogoGiorno').showModal();
  }

  function tipoScelto() { const r = document.querySelector('input[name="tipo"]:checked'); return r ? r.value : 'ufficio'; }

  function aggiornaDialogo() {
    const i = imp();
    const tipo = tipoScelto();
    const lavoro = tipo === 'ufficio' || isT(tipo);
    document.querySelectorAll('[data-mostra="trasferta"]').forEach((e) => { e.hidden = !isT(tipo); });
    document.querySelectorAll('[data-mostra="regione"]').forEach((e) => { e.hidden = tipo !== 'trasferta'; });
    document.querySelectorAll('[data-mostra="piattaforma"]').forEach((e) => { e.hidden = tipo !== 'piattaforma'; });
    document.querySelectorAll('[data-mostra="lavoro"]').forEach((e) => { e.hidden = !lavoro; });
    document.querySelectorAll('[data-mostra="permessi"]').forEach((e) => { e.hidden = !(tipo === 'ufficio' || tipo === 'permesso'); });
    if (lavoro && !$('#ore').dataset.toccato) {
      $('#ore').value = isT(tipo) ? i.orari.turnoTrasferta : i.orari.turnoUfficio;
      $('#minuti').value = '0';
    }
    const data = giornoAperto;
    const gs = M.giornoSettimana(data);
    const nonLav = gs === 0 || gs === 6 || M.festivita(data, i);
    const turno = isT(tipo) ? i.orari.turnoTrasferta : i.orari.turnoUfficio;
    const blocco = i.orari.bloccoMinuti;
    $('#aiutoOre').textContent = nonLav
      ? `Giorno non lavorativo: tutte le ore sono pagate con la maggiorazione ${gs === 6 && !M.festivita(data, i) ? 'del sabato (' + i.maggiorazioni.sabato : 'festiva (' + i.maggiorazioni.festivo}%).`
      : `Turno ${isT(tipo) ? 'trasferta' : 'ufficio'} ${turno} h: straordinario da ${turno} h ${blocco} min, a blocchi di ${blocco} minuti.`;
    const t = i.trasferte;
    $('#aiutoSpese').textContent = `Massimali: colazione ${num(t.maxColazione)} €, pranzo ${num(t.maxPranzo)} €, cena ${num(t.maxCena)} € (l'esubero di pranzo e cena viene trattenuto). In trasferta continuativa: cena o hotel → Base, solo pranzo → Media, nessun rimborso → Piena.`;
    const c = M.classificaTrasferte(dati.giorni, i, data, data)[data];
    $('#infoTrasferta').textContent = isT(tipo) && c
      ? `Trasferta attuale (dati salvati): ${c.giorniCatena} giorni, di cui ${c.fuori} fuori regione${c.piattaforma ? ` e ${c.piattaforma} in piattaforma` : ''} → ${c.continuativa ? 'continuativa' : 'non continuativa'}, indennità ${c.codice === 'base' ? 'Base' : c.codice === 'media' ? 'Media' : 'Piena'}.`
      : '';
  }

  function leggiDialogo() {
    const tipo = tipoScelto();
    const rec = { tipo };
    if (tipo === 'trasferta') rec.regione = document.querySelector('input[name="regione"]:checked').value;
    if (tipo === 'piattaforma') rec.pernotto = document.querySelector('input[name="pernotto"]:checked').value;
    if (tipo === 'ufficio' || isT(tipo)) {
      const min = Math.max(0, Math.min(24 * 60, Number($('#ore').value || 0) * 60 + Number($('#minuti').value || 0)));
      rec.minuti = min;
    }
    if (isT(tipo)) {
      const spese = {};
      for (const [k, id] of [['colazione', 'Colazione'], ['pranzo', 'Pranzo'], ['cena', 'Cena'], ['hotel', 'Hotel']]) {
        const importo = Number(String($(`#i${id}`).value).replace(',', '.')) || 0;
        const r = $(`#r${id}`).checked || importo > 0;
        if (r) spese[k] = { r: true, importo };
      }
      if (Object.keys(spese).length) rec.spese = spese;
    }
    if ((tipo === 'ufficio' || tipo === 'permesso') && Number($('#permessoOre').value)) rec.permessoOre = Number($('#permessoOre').value);
    const nota = $('#nota').value.trim();
    if (nota) rec.nota = nota;
    return rec;
  }

  function salvaGiorno() {
    const rec = leggiDialogo();
    dati.giorni[giornoAperto] = rec;
    const fino = $('#copiaFino').value;
    let copiati = 0;
    if (fino && fino > giornoAperto) {
      const i = imp();
      const weekend = $('#copiaWeekend').checked;
      for (let d = M.aggiungiGiorni(giornoAperto, 1); d <= fino; d = M.aggiungiGiorni(d, 1)) {
        const gs = M.giornoSettimana(d);
        if (!weekend && (gs === 0 || gs === 6 || M.festivita(d, i))) continue;
        dati.giorni[d] = M.clona(rec); copiati++;
      }
    }
    salva(); invalida(); render();
    if (copiati) toast(`Salvato e copiato su altri ${copiati} giorni.`);
  }

  /* ---------------- Busta ---------------- */
  function htmlBusta(r, perStampa) {
    const i = imp();
    const riga = (v, conTag) => {
      let tag = '';
      if (conTag && v.soggetta === false && !v.fiscale) tag = ' <span class="esente">esente</span>';
      if (conTag && v.c10) tag = ' <span class="agevolata">tassata al 15%</span>';
      return `<tr><td>${esc(v.descr)}${tag}</td><td class="num">${v.base != null ? num(v.base, 5) : ''}</td><td class="num">${esc(v.rif || '')}</td><td class="num">${eur(v.importo)}</td></tr>`;
    };
    const d = r.dettaglio;
    const giorni = r.conteggio;
    const nTrasf = Object.keys(r.trasferte).filter((k) => k.startsWith(M.chiaveMese(r.anno, r.mese)) && dati.giorni[k] && isT(dati.giorni[k].tipo)).length;
    let html = '';
    if (!perStampa) html += r.avvisi.map((a) => `<div class="avviso">${esc(a)}</div>`).join('');
    html += `<div class="pannello-card scorrevole"><h3>Competenze</h3><table class="tabella">
      <thead><tr><th>Voce</th><th class="num">Importo base</th><th class="num">Riferimento</th><th class="num">Importo</th></tr></thead>
      <tbody>${r.competenze.map((v) => riga(v, true)).join('')}
      <tr class="totale"><td>Totale competenze</td><td></td><td></td><td class="num">${eur(r.totali.competenze)}</td></tr></tbody></table></div>`;
    html += `<div class="pannello-card scorrevole"><h3>Trattenute</h3><table class="tabella">
      <thead><tr><th>Voce</th><th class="num">Imponibile</th><th class="num">Riferimento</th><th class="num">Importo</th></tr></thead>
      <tbody>${r.trattenute.map((v) => `<tr><td>${esc(v.descr)}</td><td class="num">${v.base != null ? num(v.base) : ''}</td><td class="num">${esc(v.rif || '')}</td><td class="num">${eur(v.importo)}</td></tr>`).join('')}
      <tr class="totale"><td>Totale trattenute</td><td></td><td></td><td class="num">${eur(r.totali.trattenute)}</td></tr></tbody></table></div>`;
    html += `<div class="netto-grande"><span>Netto del mese<br><small>accredito previsto ${dataIt(r.accredito)}</small></span><strong>${eur(r.totali.netto)}</strong></div>`;
    if (r.informative.length && (i.riepilogo.mostraRimborsi || perStampa)) {
      html += `<div class="pannello-card"><h3>Non inclusi nel netto</h3><table class="tabella"><tbody>
        ${r.informative.map((v) => `<tr><td>${esc(v.descr)}</td><td class="num">${esc(v.rif || '')}</td><td class="num">${eur(v.importo)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    html += `<div class="pannello-card"><h3>Dettaglio fiscale</h3><table class="tabella"><tbody>
      <tr><td>Imponibile INPS</td><td class="num">${eur(d.impInps)}</td></tr>
      <tr><td>Imponibile IRPEF</td><td class="num">${eur(d.impIrpef)}</td></tr>
      <tr><td>IRPEF lorda</td><td class="num">${eur(d.irpefLorda)}</td></tr>
      <tr><td>Detrazioni lavoro dipendente</td><td class="num">${eur(d.detrLav)}</td></tr>
      <tr><td>Ulteriore detrazione L.207/24</td><td class="num">${eur(d.ultDetr)}</td></tr>
      ${d.baseC7 ? `<tr><td>Imponibile rinnovi (5%)</td><td class="num">${eur(d.baseC7)}</td></tr>` : ''}
      ${d.baseC10 ? `<tr><td>Imponibile maggiorazioni (15%)</td><td class="num">${eur(d.baseC10)}</td></tr>` : ''}
      ${r.conguaglio ? `<tr><td>Conguaglio: imponibile annuo / IRPEF dovuta / già pagata</td><td class="num">${eur(r.conguaglio.imponibileAnno)} / ${eur(r.conguaglio.dovuta)} / ${eur(r.conguaglio.pagata)}</td></tr>` : ''}
      </tbody></table>
      <p class="aiuto">Giorni: ${giorni.ufficio} ufficio · ${nTrasf} trasferta (di cui ${giorni.piattaforma} in piattaforma) · ${giorni.ferie} ferie · ${giorni.malattia} malattia · ${num(giorni.permessoOre)} h permesso · ${giorni.formazione} formazione</p></div>`;
    return html;
  }

  function renderBusta(r) {
    $('#busta').innerHTML = htmlBusta(r, false);
    const km = M.chiaveMese(anno, mese);
    const dm = dati.mesi[km] || {};
    const voci = dm.voci || [];
    $('#vociManuali').innerHTML = voci.length ? voci.map((v, idx) => `
      <div class="voce-manuale" data-idx="${idx}">
        <input type="text" data-campo="descrizione" value="${esc(v.descrizione || '')}" placeholder="Descrizione" aria-label="Descrizione">
        <input type="number" step="0.01" inputmode="decimal" data-campo="importo" value="${v.importo || ''}" placeholder="€" aria-label="Importo">
        <select data-campo="tipo" aria-label="Tipo">
          <option value="competenza" ${v.tipo !== 'trattenuta' && v.soggetta !== false ? 'selected' : ''}>+ Lordo tassato</option>
          <option value="esente" ${v.tipo !== 'trattenuta' && v.soggetta === false ? 'selected' : ''}>+ Netto esente</option>
          <option value="trattenuta" ${v.tipo === 'trattenuta' ? 'selected' : ''}>− Trattenuta</option>
        </select>
        <button class="btn piccolo pericolo" data-azione="rimuovi-voce" aria-label="Rimuovi">✕</button>
      </div>`).join('') : '<p class="aiuto">Nessuna voce manuale in questo mese.</p>';
    $('#nettoReale').value = dm.nettoReale != null ? dm.nettoReale : '';
    aggiornaConfronto(r);
  }
  function aggiornaConfronto(r) {
    const dm = dati.mesi[M.chiaveMese(anno, mese)] || {};
    if (dm.nettoReale == null || dm.nettoReale === '') { $('#confronto').textContent = 'Inserisci il netto della busta quando arriva: lo storico mostrerà la differenza con la stima.'; return; }
    const diff = M.r2(Number(dm.nettoReale) - r.totali.netto);
    $('#confronto').innerHTML = `Differenza reale − stima: <strong class="${Math.abs(diff) <= 5 ? 'positivo' : 'negativo'}">${diff > 0 ? '+' : ''}${eur(diff)}</strong>`;
  }
  function datiMese() {
    const km = M.chiaveMese(anno, mese);
    if (!dati.mesi[km]) dati.mesi[km] = {};
    return dati.mesi[km];
  }

  /* ---------------- Storico ---------------- */
  function righeAnno(y) {
    const righe = [];
    for (let m = 1; m <= 12; m++) {
      const pref = M.chiaveMese(y, m);
      const haDati = Object.keys(dati.giorni).some((k) => k.startsWith(pref)) || (dati.mesi[pref] && (dati.mesi[pref].nettoReale != null || (dati.mesi[pref].voci || []).length));
      const r = calcola(y, m);
      const trasf = Object.keys(dati.giorni).filter((k) => k.startsWith(pref) && isT(dati.giorni[k].tipo)).length;
      const reale = dati.mesi[pref] && dati.mesi[pref].nettoReale !== '' && dati.mesi[pref].nettoReale != null ? Number(dati.mesi[pref].nettoReale) : null;
      righe.push({ m, haDati, r, trasf, reale });
    }
    return righe;
  }
  function htmlStorico(y, perStampa) {
    const righe = righeAnno(y);
    const conDati = righe.filter((x) => x.haDati);
    const tot = (f) => conDati.reduce((s, x) => s + f(x), 0);
    let html = `<div class="pannello-card scorrevole"><table class="tabella">
      <thead><tr><th>Mese</th><th class="num">Gg trasf.</th><th class="num">Lordo</th><th class="num">Trattenute</th><th class="num">Netto stimato</th><th class="num">Netto reale</th><th class="num">Diff.</th></tr></thead><tbody>`;
    for (const x of righe) {
      const diff = x.reale != null ? M.r2(x.reale - x.r.totali.netto) : null;
      html += `<tr ${perStampa ? '' : `data-mese="${x.m}" style="cursor:pointer${x.haDati ? '' : ';opacity:.5'}"`}>
        <td><span style="text-transform:capitalize">${MESI[x.m - 1]}</span>${x.haDati ? '' : ' <span class="aiuto">(nessun dato)</span>'}</td>
        <td class="num">${x.trasf || ''}</td><td class="num">${eur(x.r.totali.lordo)}</td><td class="num">${eur(x.r.totali.trattenute)}</td>
        <td class="num"><strong>${eur(x.r.totali.netto)}</strong></td><td class="num">${x.reale != null ? eur(x.reale) : ''}</td>
        <td class="num ${diff == null ? '' : Math.abs(diff) <= 5 ? 'positivo' : 'negativo'}">${diff != null ? eur(diff) : ''}</td></tr>`;
    }
    html += `<tr class="totale"><td>Totale mesi con dati (${conDati.length})</td><td class="num">${tot((x) => x.trasf)}</td><td class="num">${eur(tot((x) => x.r.totali.lordo))}</td>
      <td class="num">${eur(tot((x) => x.r.totali.trattenute))}</td><td class="num">${eur(tot((x) => x.r.totali.netto))}</td><td></td><td></td></tr></tbody></table></div>`;
    const buoni = tot((x) => (x.r.informative.find((v) => v.descr.startsWith('Buoni')) || { importo: 0 }).importo);
    const indenn = tot((x) => x.r.competenze.filter((c) => c.id === 'indennita').reduce((s, c) => s + c.importo, 0));
    const diaria = tot((x) => x.r.competenze.filter((c) => c.id === 'diaria').reduce((s, c) => s + c.importo, 0));
    html += `<div class="pannello-card"><h3>Riepilogo ${y}</h3><table class="tabella"><tbody>
      <tr><td>Diaria soggetta</td><td class="num">${eur(diaria)}</td></tr>
      <tr><td>Indennità di trasferta esenti</td><td class="num">${eur(indenn)}</td></tr>
      <tr><td>Buoni pasto</td><td class="num">${eur(buoni)}</td></tr>
      <tr><td>Contributi INPS</td><td class="num">${eur(tot((x) => x.r.trattenute.filter((t) => ['ivs', 'cigs', 'contr13'].includes(t.id)).reduce((s, t) => s + t.importo, 0)))}</td></tr>
      <tr><td>IRPEF e imposte sostitutive</td><td class="num">${eur(tot((x) => x.r.trattenute.filter((t) => ['irpef', 'irpef13', 'sost7', 'sost10', 'conguaglio'].includes(t.id)).reduce((s, t) => s + t.importo, 0)))}</td></tr>
      </tbody></table></div>`;
    return html;
  }
  function renderStorico() {
    $('#titoloAnno').textContent = annoStorico;
    $('#storico').innerHTML = htmlStorico(annoStorico, false);
  }

  /* ---------------- Stampa / PDF ---------------- */
  function stampa(html, titolo) {
    $('#stampa').innerHTML = html;
    const t = document.title;
    document.title = titolo;
    window.print();
    setTimeout(() => { document.title = t; }, 500);
  }
  function stampaMese() {
    const r = calcola(anno, mese);
    const i = imp();
    const pref = M.chiaveMese(anno, mese);
    const giorni = Object.keys(dati.giorni).filter((k) => k.startsWith(pref)).sort();
    const righe = giorni.map((d) => {
      const g = dati.giorni[d];
      const c = r.trasferte[d];
      const s = g.spese || {};
      const sp = ['colazione', 'pranzo', 'cena', 'hotel'].filter((k) => s[k] && s[k].r).map((k) => `${k}${s[k].importo ? ' ' + num(s[k].importo) + ' €' : ''}`).join(', ');
      return `<tr><td>${dataIt(d)}</td><td>${esc(M.TIPI[g.tipo] ? M.TIPI[g.tipo].nome : '')}${g.tipo === 'trasferta' ? (g.regione === 'fuori' ? ' fuori regione' : ' in regione') : ''}${g.tipo === 'piattaforma' && g.pernotto ? ' (' + NOTTI[g.pernotto] + ')' : ''}</td>
        <td class="num">${g.minuti != null ? `${Math.floor(g.minuti / 60)}:${String(g.minuti % 60).padStart(2, '0')}` : ''}</td>
        <td>${c && isT(g.tipo) ? ({ base: 'Base', media: 'Media', piena: 'Piena' })[c.codice] : ''}</td><td>${esc(sp)}</td><td>${esc(g.nota || '')}</td></tr>`;
    }).join('');
    const html = `<h1>Busta stimata — ${MESI[mese - 1]} ${anno}</h1>
      <p class="aiuto">${esc(i.contratto.ccnl)} · livello ${esc(i.contratto.livello)} · generato il ${new Date().toLocaleDateString('it-IT')}. Stima non ufficiale.</p>
      ${htmlBusta(r, true)}
      ${r.avvisi.length ? `<h2>Note</h2><ul>${r.avvisi.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      <h2>Giorni</h2><table class="tabella"><thead><tr><th>Data</th><th>Tipo</th><th class="num">Ore</th><th>Indennità</th><th>Rimborsi</th><th>Nota</th></tr></thead><tbody>${righe}</tbody></table>`;
    stampa(html, `Stipendio ${MESI[mese - 1]} ${anno}`);
  }
  function stampaAnno() {
    stampa(`<h1>Riepilogo stipendio ${annoStorico}</h1><p class="aiuto">Generato il ${new Date().toLocaleDateString('it-IT')}. Stima non ufficiale.</p>${htmlStorico(annoStorico, true)}`, `Stipendio ${annoStorico}`);
  }

  /* ---------------- Backup ---------------- */
  function esporta() {
    dati.meta.ultimoBackup = new Date().toISOString();
    salva();
    const blob = new Blob([JSON.stringify({ app: 'calcolo-stipendio', versione: 1, esportato: dati.meta.ultimoBackup, giorni: dati.giorni, mesi: dati.mesi, impostazioni: dati.impostazioni }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `stipendio-backup-${oggiIso()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    render();
  }
  function importa() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files[0];
      if (!f) return;
      f.text().then((txt) => {
        let d;
        try { d = JSON.parse(txt); } catch (e) { toast('File non valido: non è un JSON.'); return; }
        if (!d || d.app !== 'calcolo-stipendio' || typeof d !== 'object') { toast('File non valido: non è un backup di questa app.'); return; }
        const nGiorni = Object.keys(d.giorni || {}).length;
        const msg = nGiorni
          ? `Importare ${nGiorni} giorni e le impostazioni? I dati attuali verranno sostituiti.`
          : 'Importare il profilo (impostazioni)? I giorni già inseriti restano invariati.';
        if (!confirm(msg)) return;
        if (nGiorni) { dati.giorni = d.giorni || {}; dati.mesi = d.mesi || {}; }
        if (d.impostazioni) dati.impostazioni = M.normalizzaImpostazioni(d.impostazioni);
        salva(); invalida(); render();
        toast('Importazione completata.');
      });
    };
    inp.click();
  }

  /* ---------------- Impostazioni ---------------- */
  const MESI_OPZ = MESI.map((n, k) => [k + 1, n]);
  const SCHEMA = [
    { titolo: 'Aspetto', campi: [
      { p: 'aspetto.tema', l: 'Tema', t: 'select', o: [['auto', 'Automatico (come il sistema)'], ['chiaro', 'Chiaro'], ['scuro', 'Scuro']] },
      { p: 'aspetto.primoGiorno', l: 'Primo giorno della settimana', t: 'select', o: [[1, 'Lunedì'], [0, 'Domenica']], n: true },
      { p: 'aspetto.testo', l: 'Dimensione del testo', t: 'select', o: [['normale', 'Normale'], ['grande', 'Grande']] },
    ] },
    { titolo: 'Contratto e retribuzione', aiuto: 'Valori dalla busta paga. Ogni periodo vale dalla sua data in poi: aggiungi un periodo per scatti, passaggi di livello o fine apprendistato.', campi: [
      { p: 'contratto.ccnl', l: 'CCNL', t: 'text' },
      { p: 'contratto.livello', l: 'Livello', t: 'text' },
      { p: 'contratto.divisoreGiorni', l: 'Divisore giornaliero', t: 'number' },
      { p: 'contratto.divisoreOre', l: 'Divisore orario', t: 'number' },
      { p: 'contratto.meseTredicesima', l: 'Mese della tredicesima', t: 'select', o: MESI_OPZ, n: true },
      { p: 'contratto.giornoAccredito', l: 'Giorno di accredito (mese dopo)', t: 'number' },
    ], tabelle: [
      { p: 'periodi', l: 'Periodi contrattuali', col: [['dal', 'Valido dal', 'date'], ['pagaBasePiena', 'Paga base piena €', 'number'], ['percentualePaga', '% paga', 'number'], ['aliquotaIVS', 'INPS IVS %', 'number'], ['aliquotaCIGS', 'CIGS %', 'number'], ['quotaRinnovo', 'Quota rinnovo 5% €', 'number']],
        nuovo: () => Object.assign({}, imp().periodi.slice(-1)[0], { dal: oggiIso() }) },
    ] },
    { titolo: 'Orari', campi: [
      { p: 'orari.turnoUfficio', l: 'Turno ufficio (ore)', t: 'number' },
      { p: 'orari.turnoTrasferta', l: 'Turno trasferta (ore)', t: 'number' },
      { p: 'orari.bloccoMinuti', l: 'Blocco straordinario (minuti)', t: 'number' },
    ] },
    { titolo: 'Maggiorazioni', aiuto: 'Valori CCNL predefiniti: verificali con una busta paga che contiene straordinari o sabati lavorati.', campi: [
      { p: 'maggiorazioni.straordinarioPrime2', l: 'Straordinario feriale, prime 2 ore %', t: 'number' },
      { p: 'maggiorazioni.straordinarioOltre', l: 'Straordinario feriale, oltre %', t: 'number' },
      { p: 'maggiorazioni.sabato', l: 'Sabato lavorato %', t: 'number' },
      { p: 'maggiorazioni.festivo', l: 'Domenica / festivo %', t: 'number' },
      { p: 'maggiorazioni.agevolato15Festivo', l: 'Festivo tassato al 15%', t: 'check' },
      { p: 'maggiorazioni.agevolato15Sabato', l: 'Sabato tassato al 15%', t: 'check' },
      { p: 'maggiorazioni.agevolato15Straordinari', l: 'Straordinari tassati al 15%', t: 'check' },
    ] },
    { titolo: 'Trasferte', campi: [
      { p: 'trasferte.diaria', l: 'Diaria lorda al giorno €', t: 'number' },
      { p: 'trasferte.base', l: 'Indennità Base (331) €', t: 'number' },
      { p: 'trasferte.media', l: 'Indennità Media (333) €', t: 'number' },
      { p: 'trasferte.piena', l: 'Indennità Piena (337) €', t: 'number' },
      { p: 'trasferte.sogliaFuori', l: 'Continuativa da N giorni fuori regione', t: 'number' },
      { p: 'trasferte.sogliaTotale', l: 'Continuativa da N giorni totali', t: 'number' },
      { p: 'trasferte.sogliaPiattaforma', l: 'Con piattaforma: continuativa da N giorni', t: 'number' },
      { p: 'trasferte.maxColazione', l: 'Massimale colazione €', t: 'number' },
      { p: 'trasferte.maxPranzo', l: 'Massimale pranzo €', t: 'number' },
      { p: 'trasferte.maxCena', l: 'Massimale cena €', t: 'number' },
    ] },
    { titolo: 'Buoni pasto', campi: [
      { p: 'buoniPasto.valore', l: 'Valore buono €', t: 'number' },
      { p: 'buoniPasto.ancheInTrasferta', l: 'Spettano anche in trasferta', t: 'check' },
    ] },
    { titolo: 'Una tantum ricorrenti', aiuto: 'Importi lordi pagati ogni anno nello stesso mese (es. elemento perequativo a giugno).', tabelle: [
      { p: 'unaTantumRicorrenti', l: '', col: [['mese', 'Mese (1-12)', 'number'], ['descrizione', 'Descrizione', 'text'], ['importo', 'Importo €', 'number']], nuovo: () => ({ mese: 1, descrizione: '', importo: 0 }) },
    ] },
    { titolo: 'Fisco', aiuto: 'Copia dalla busta paga le rate delle addizionali (voci F091..). I progressivi servono per stimare il conguaglio di dicembre.', tabelle: [
      { p: 'addizionali', l: 'Rate addizionali', col: [['anno', 'Anno busta', 'number'], ['descrizione', 'Descrizione', 'text'], ['rata', 'Rata €', 'number'], ['daMese', 'Dal mese', 'number'], ['aMese', 'Al mese', 'number']],
        nuovo: () => ({ anno: anno, descrizione: 'Addizionale', rata: 0, daMese: 1, aMese: 11 }) },
    ], campi: [
      { p: 'progressivi.mese', l: 'Progressivi aggiornati al mese', t: 'month' },
      { p: 'progressivi.imponibileIrpef', l: 'Progressivo imponibile IRPEF €', t: 'number' },
      { p: 'progressivi.irpefPagata', l: 'Progressivo IRPEF pagata €', t: 'number' },
    ] },
    { titolo: 'Calendario', campi: [
      { p: 'calendario.patrono', l: 'Santo patrono (MM-GG)', t: 'text' },
      { p: 'calendario.festivitaExtra', l: 'Altre festività (MM-GG, separate da virgola)', t: 'lista' },
    ] },
    { titolo: 'Riepilogo', campi: [
      { p: 'riepilogo.mostraRimborsi', l: 'Mostra buoni pasto e spese carta nella busta', t: 'check' },
    ] },
    { titolo: 'Dati e backup', aiuto: 'I dati restano solo su questo dispositivo. Usa il backup per spostarli su un altro dispositivo.', campi: [
      { p: 'backup.promemoriaGiorni', l: 'Promemoria backup ogni N giorni (0 = mai)', t: 'number' },
    ], azioni: true },
  ];
  const leggi = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const scrivi = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); const t = ks.reduce((x, k) => (x[k] = x[k] || {}), o); t[last] = v; };

  function renderImpostazioni() {
    const i = imp();
    const aperte = new Set([...document.querySelectorAll('.sezione-imp[open]')].map((d) => d.dataset.titolo));
    let html = '';
    for (const s of SCHEMA) {
      html += `<details class="sezione-imp" data-titolo="${esc(s.titolo)}" ${aperte.has(s.titolo) ? 'open' : ''}><summary>${esc(s.titolo)}</summary><div class="corpo">`;
      if (s.aiuto) html += `<p class="aiuto">${esc(s.aiuto)}</p>`;
      if (s.campi) {
        html += '<div class="griglia-imp">';
        for (const c of s.campi) {
          const v = leggi(i, c.p);
          if (c.t === 'check') html += `<label class="campo check"><input type="checkbox" data-p="${c.p}" ${v ? 'checked' : ''}> ${esc(c.l)}</label>`;
          else if (c.t === 'select') html += `<label class="campo">${esc(c.l)}<select data-p="${c.p}" ${c.n ? 'data-n="1"' : ''}>${c.o.map(([val, t]) => `<option value="${val}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
          else if (c.t === 'lista') html += `<label class="campo">${esc(c.l)}<input type="text" data-p="${c.p}" data-lista="1" value="${esc((v || []).join(', '))}"></label>`;
          else html += `<label class="campo">${esc(c.l)}<input type="${c.t}" ${c.t === 'number' ? 'step="any" inputmode="decimal"' : ''} data-p="${c.p}" ${c.t === 'number' ? 'data-n="1"' : ''} value="${esc(v == null ? '' : v)}"></label>`;
        }
        html += '</div>';
      }
      for (const tb of s.tabelle || []) {
        const righe = leggi(i, tb.p) || [];
        html += `${tb.l ? `<h3>${esc(tb.l)}</h3>` : ''}<div class="righe-tabella"><table><thead><tr>${tb.col.map((c) => `<th>${esc(c[1])}</th>`).join('')}<th></th></tr></thead><tbody>
          ${righe.map((r, idx) => `<tr>${tb.col.map(([k, , t]) => `<td><input type="${t}" ${t === 'number' ? 'step="any" inputmode="decimal"' : ''} data-tab="${tb.p}" data-idx="${idx}" data-k="${k}" ${t === 'number' ? 'data-n="1"' : ''} value="${esc(r[k] == null ? '' : r[k])}"></td>`).join('')}
            <td><button class="btn piccolo pericolo" data-azione="rimuovi-riga" data-tab="${tb.p}" data-idx="${idx}" aria-label="Rimuovi riga">✕</button></td></tr>`).join('')}
          </tbody></table></div><button class="btn piccolo" data-azione="aggiungi-riga" data-tab="${tb.p}">+ Aggiungi riga</button>`;
      }
      if (s.azioni) {
        html += `<div class="azioni-mese">
          <button class="btn primario" data-azione="esporta">Scarica backup</button>
          <button class="btn" data-azione="importa">Importa backup o profilo</button>
          <button class="btn" data-azione="ripristina-imp">Ripristina impostazioni predefinite</button>
          <button class="btn pericolo" data-azione="cancella-tutto">Cancella tutti i dati</button></div>
          <p class="aiuto">${Object.keys(dati.giorni).length} giorni salvati.${dati.meta.ultimoBackup ? ' Ultimo backup: ' + new Date(dati.meta.ultimoBackup).toLocaleDateString('it-IT') + '.' : ''}</p>`;
      }
      html += '</div></details>';
    }
    $('#impostazioni').innerHTML = html;
  }

  function aggiornaImpostazione(el) {
    const i = impModificabili();
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.dataset.lista) v = el.value.split(',').map((x) => x.trim()).filter(Boolean);
    else if (el.dataset.n) { v = Number(String(el.value).replace(',', '.')); if (isNaN(v)) return; }
    else v = el.value;
    if (el.dataset.tab) {
      const arr = leggi(i, el.dataset.tab);
      arr[Number(el.dataset.idx)][el.dataset.k] = v;
    } else scrivi(i, el.dataset.p, v);
    salva(); invalida();
    applicaAspetto();
    const r = calcola(anno, mese);
    $('#lordo').textContent = eur(r.totali.lordo);
    $('#netto').textContent = eur(r.totali.netto);
    renderBanner();
  }

  /* ---------------- Eventi ---------------- */
  function cambiaMese(delta) {
    mese += delta;
    if (mese < 1) { mese = 12; anno--; }
    if (mese > 12) { mese = 1; anno++; }
    render();
  }
  $('#mesePrec').onclick = () => cambiaMese(-1);
  $('#meseSucc').onclick = () => cambiaMese(1);
  $('#annoPrec').onclick = () => { annoStorico--; renderStorico(); };
  $('#annoSucc').onclick = () => { annoStorico++; renderStorico(); };
  const apriBusta = () => { vista = 'busta'; render(); };
  $('#riepilogo').onclick = apriBusta;
  $('#riepilogo').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apriBusta(); } };
  document.querySelectorAll('.schede button').forEach((b) => { b.onclick = () => { vista = b.dataset.vista; if (vista === 'storico') annoStorico = anno; render(); }; });

  $('#calendario').onclick = (e) => { const b = e.target.closest('.giorno[data-data]'); if (b) apriGiorno(b.dataset.data); };
  $('#sceltaTipo').onchange = () => { $('#ore').dataset.toccato = ''; aggiornaDialogo(); };
  $('#ore').oninput = $('#minuti').onchange = () => { $('#ore').dataset.toccato = '1'; };
  for (const id of ['Colazione', 'Pranzo', 'Cena', 'Hotel']) {
    $(`#i${id}`).oninput = () => { if (Number($(`#i${id}`).value) > 0) $(`#r${id}`).checked = true; };
  }
  $('#formGiorno').onsubmit = (e) => {
    const azione = e.submitter ? e.submitter.value : 'salva';
    if (azione === 'salva') salvaGiorno();
    else if (azione === 'cancella') { delete dati.giorni[giornoAperto]; salva(); invalida(); render(); }
  };

  $('#riempiUfficio').onclick = () => {
    const i = imp();
    let n = 0;
    for (let d = 1; d <= M.giorniNelMese(anno, mese); d++) {
      const data = M.iso(anno, mese, d);
      if (!M.tipoGiorno(data, dati.giorni, i)) { dati.giorni[data] = { tipo: 'ufficio', minuti: i.orari.turnoUfficio * 60 }; n++; }
    }
    salva(); invalida(); render();
    toast(n ? `${n} giorni impostati come Ufficio.` : 'Nessun giorno feriale da compilare.');
  };

  $('#aggiungiVoce').onclick = () => { const dm = datiMese(); dm.voci = dm.voci || []; dm.voci.push({ descrizione: '', importo: '', tipo: 'competenza', soggetta: true }); salva(); render(); };
  $('#vociManuali').addEventListener('change', (e) => {
    const riga = e.target.closest('.voce-manuale');
    if (!riga) return;
    const v = datiMese().voci[Number(riga.dataset.idx)];
    const campo = e.target.dataset.campo;
    if (campo === 'importo') v.importo = Number(String(e.target.value).replace(',', '.')) || 0;
    else if (campo === 'tipo') { v.tipo = e.target.value === 'trattenuta' ? 'trattenuta' : 'competenza'; v.soggetta = e.target.value === 'competenza'; }
    else v[campo] = e.target.value;
    salva(); invalida(); render();
  });
  $('#nettoReale').onchange = (e) => {
    const v = e.target.value === '' ? null : Number(String(e.target.value).replace(',', '.'));
    datiMese().nettoReale = v;
    salva(); aggiornaConfronto(calcola(anno, mese));
  };
  $('#stampaMese').onclick = stampaMese;
  $('#stampaAnno').onclick = stampaAnno;
  $('#storico').onclick = (e) => { const tr = e.target.closest('tr[data-mese]'); if (tr) { anno = annoStorico; mese = Number(tr.dataset.mese); vista = 'calendario'; render(); } };

  $('#impostazioni').addEventListener('change', (e) => { if (e.target.matches('[data-p], [data-tab]') && !e.target.matches('button')) aggiornaImpostazione(e.target); });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-azione]');
    if (!b) return;
    const a = b.dataset.azione;
    if (a === 'vai-imp') { vista = 'impostazioni'; render(); }
    else if (a === 'esporta') esporta();
    else if (a === 'importa') importa();
    else if (a === 'rimuovi-voce') { const idx = Number(b.closest('.voce-manuale').dataset.idx); datiMese().voci.splice(idx, 1); salva(); invalida(); render(); }
    else if (a === 'aggiungi-riga') {
      const i = impModificabili();
      const tb = SCHEMA.flatMap((s) => s.tabelle || []).find((t) => t.p === b.dataset.tab);
      leggi(i, tb.p).push(tb.nuovo()); salva(); invalida(); renderImpostazioni();
    } else if (a === 'rimuovi-riga') {
      const i = impModificabili();
      const arr = leggi(i, b.dataset.tab);
      if (b.dataset.tab === 'periodi' && arr.length <= 1) { toast('Serve almeno un periodo contrattuale.'); return; }
      arr.splice(Number(b.dataset.idx), 1); salva(); invalida(); renderImpostazioni();
    } else if (a === 'ripristina-imp') {
      if (confirm('Ripristinare le impostazioni predefinite? I giorni inseriti restano.')) { dati.impostazioni = M.clona(M.IMPOSTAZIONI_DEFAULT); salva(); invalida(); render(); }
    } else if (a === 'cancella-tutto') {
      if (confirm('Cancellare TUTTI i dati (giorni, impostazioni, storico)? Operazione non annullabile.') && confirm('Sei sicuro? Ti consiglio di scaricare prima un backup.')) {
        dati = { giorni: {}, mesi: {}, impostazioni: null, meta: {} }; salva(); invalida(); render();
      }
    }
  });

  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applicaAspetto);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
})();
