/*
 * Motore di calcolo dello stipendio.
 * Funzioni pure, senza accesso al DOM: usate dall'app nel browser e dai test in Node.
 */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Motore = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Utilità                                                             */
  /* ------------------------------------------------------------------ */
  const r2 = (x) => Math.sign(x) * Math.round((Math.abs(x) + 1e-9) * 100) / 100;
  const r5 = (x) => Math.round((x + 1e-12) * 1e5) / 1e5;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const giorniNelMese = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const parse = (s) => s.split('-').map(Number);
  const giornoSettimana = (s) => { const [y, m, d] = parse(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }; // 0 = domenica
  const aggiungiGiorni = (s, n) => { const [y, m, d] = parse(s); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const chiaveMese = (y, m) => `${y}-${pad(m)}`;
  const clona = (o) => JSON.parse(JSON.stringify(o));

  function unisciProfondo(base, extra) {
    const out = clona(base);
    if (!extra) return out;
    for (const k of Object.keys(extra)) {
      const v = extra[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
        out[k] = unisciProfondo(out[k], v);
      } else {
        out[k] = clona(v);
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Regole fiscali per anno (aggiornabili senza toccare il resto)       */
  /* ------------------------------------------------------------------ */
  const REGOLE_FISCALI = {
    2026: {
      scaglioni: [[28000, 23], [50000, 33], [Infinity, 43]],
      divisoreMensile: 13, // scaglioni annui / 13 per ogni mensilità (verificato su buste Zucchetti)
      sostitutivaRinnovi: 5, // L.199/25 c.7
      sostitutivaMaggiorazioni: 15, // L.199/25 c.10
      tettoMaggiorazioni15: 1500,
    },
  };
  function regoleAnno(anno) {
    if (REGOLE_FISCALI[anno]) return REGOLE_FISCALI[anno];
    const anni = Object.keys(REGOLE_FISCALI).map(Number).sort((a, b) => a - b);
    return REGOLE_FISCALI[anni.filter((a) => a <= anno).pop() || anni[0]];
  }

  function impostaScaglioni(imponibile, scaglioni, divisore) {
    let tassa = 0, prec = 0;
    for (const [limite, aliquota] of scaglioni) {
      const lim = limite / divisore;
      if (imponibile > prec) tassa += (Math.min(imponibile, lim) - prec) * aliquota / 100;
      prec = lim;
    }
    return tassa;
  }

  // Detrazione per lavoro dipendente (art. 13 TUIR), importo annuo.
  function detrazioneLavoroDipendente(R) {
    if (R <= 0) return 0;
    if (R <= 15000) return 1955;
    if (R <= 28000) return 1910 + 1190 * (28000 - R) / 13000;
    if (R <= 50000) return 1910 * (50000 - R) / 22000;
    return 0;
  }
  // Ulteriore detrazione L.207/24 (cuneo fiscale), importo annuo.
  function ulterioreDetrazione(R) {
    if (R <= 20000) return 0;
    if (R <= 32000) return 1000;
    if (R <= 40000) return 1000 * (40000 - R) / 8000;
    return 0;
  }
  // Somma esente L.207/24 per redditi fino a 20.000 €, in % del reddito di lavoro.
  function percentualeSommaEsente(R) {
    if (R <= 8500) return 7.1;
    if (R <= 15000) return 5.3;
    if (R <= 20000) return 4.8;
    return 0;
  }

  /* ------------------------------------------------------------------ */
  /* Impostazioni predefinite (valori CCNL, nessun dato personale)        */
  /* ------------------------------------------------------------------ */
  const IMPOSTAZIONI_DEFAULT = {
    aspetto: { tema: 'auto', primoGiorno: 1, testo: 'normale' },
    contratto: {
      ccnl: 'Metalmeccanica Industria', livello: 'C2',
      divisoreGiorni: 26, divisoreOre: 173, meseTredicesima: 12, giornoAccredito: 15,
    },
    // Parametri che cambiano nel tempo: vale il periodo con la data "dal" più recente <= giorno.
    periodi: [
      { dal: '2000-01-01', pagaBasePiena: 2064.88, percentualePaga: 100, aliquotaIVS: 9.19, aliquotaCIGS: 0.30, quotaRinnovo: 47.12 },
    ],
    orari: { turnoUfficio: 8, turnoTrasferta: 10, bloccoMinuti: 30 },
    maggiorazioni: {
      straordinarioPrime2: 25, straordinarioOltre: 30, sabato: 25, festivo: 50,
      agevolato15Festivo: true, agevolato15Sabato: false, agevolato15Straordinari: false,
    },
    trasferte: {
      diaria: 30, base: 15.49, media: 30.99, piena: 46.48,
      sogliaFuori: 2, sogliaTotale: 3,
      maxColazione: 5, maxPranzo: 30, maxCena: 40,
    },
    buoniPasto: { valore: 8, ancheInTrasferta: false },
    calendario: { patrono: '02-04', festivitaExtra: ['10-04'] },
    unaTantumRicorrenti: [{ mese: 6, descrizione: 'Elemento perequativo metalmeccanici', importo: 485 }],
    addizionali: [],
    progressivi: { mese: '', imponibileIrpef: 0, irpefPagata: 0 },
    riepilogo: { mostraRimborsi: true },
    backup: { promemoriaGiorni: 30 },
  };

  function normalizzaImpostazioni(imp) {
    return unisciProfondo(IMPOSTAZIONI_DEFAULT, imp || {});
  }

  function periodoValido(imp, data) {
    const ps = [...imp.periodi].sort((a, b) => a.dal.localeCompare(b.dal));
    let scelto = ps[0];
    for (const p of ps) if (p.dal <= data) scelto = p;
    return scelto;
  }
  const pagaMensile = (p) => r2(p.pagaBasePiena * p.percentualePaga / 100);
  const pagaOraria = (p, imp) => pagaMensile(p) / imp.contratto.divisoreOre;

  /* ------------------------------------------------------------------ */
  /* Calendario e festività                                              */
  /* ------------------------------------------------------------------ */
  function pasqua(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(y, mese, giorno);
  }
  const FESTIVITA_FISSE = {
    '01-01': 'Capodanno', '01-06': 'Epifania', '04-25': 'Liberazione', '05-01': 'Festa del lavoro',
    '06-02': 'Festa della Repubblica', '08-15': 'Ferragosto', '11-01': 'Ognissanti',
    '12-08': 'Immacolata', '12-25': 'Natale', '12-26': 'Santo Stefano',
  };
  function festivita(data, imp) {
    const md = data.slice(5);
    if (FESTIVITA_FISSE[md]) return FESTIVITA_FISSE[md];
    if (imp.calendario.patrono && md === imp.calendario.patrono) return 'Santo patrono';
    if ((imp.calendario.festivitaExtra || []).includes(md)) return 'Festività';
    const y = Number(data.slice(0, 4));
    const p = pasqua(y);
    if (data === p) return 'Pasqua';
    if (data === aggiungiGiorni(p, 1)) return 'Lunedì dell\'Angelo';
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Giorni                                                              */
  /* ------------------------------------------------------------------ */
  const TIPI = {
    ufficio: { nome: 'Ufficio', ruolo: 'reset', lavoro: true },
    trasferta: { nome: 'Trasferta', ruolo: 'trasferta', lavoro: true },
    formazione: { nome: 'Formazione in regione', ruolo: 'reset', lavoro: false },
    ferie: { nome: 'Ferie', ruolo: 'collega', lavoro: false },
    permesso: { nome: 'Permesso', ruolo: 'collega', lavoro: false },
    malattia: { nome: 'Malattia', ruolo: 'reset', lavoro: false },
    festivita: { nome: 'Festività', ruolo: 'collega', lavoro: false },
    riposo: { nome: 'Riposo', ruolo: 'collega', lavoro: false },
  };

  // Tipo effettivo di un giorno (registrato o dedotto dal calendario).
  function tipoGiorno(data, giorni, imp) {
    const rec = giorni[data];
    if (rec && rec.tipo) return rec.tipo;
    if (festivita(data, imp)) return 'festivita';
    const gs = giornoSettimana(data);
    if (gs === 0 || gs === 6) return 'riposo';
    return null; // giorno feriale non compilato
  }

  // Classifica tutti i giorni di trasferta in catene e assegna il codice di indennità.
  // Ritorna { [data]: { catena, continuativa, codice: 'base'|'media'|'piena', aperta } }
  function classificaTrasferte(giorni, imp, da, a) {
    const t = imp.trasferte;
    const inizio = aggiungiGiorni(da, -62), fine = aggiungiGiorni(a, 62);
    const risultato = {};
    let catena = null, id = 0;
    const chiudi = (aperta) => {
      if (!catena) return;
      const continuativa = catena.fuori >= t.sogliaFuori || catena.giorni.length >= t.sogliaTotale;
      for (const d of catena.giorni) {
        const s = (giorni[d] && giorni[d].spese) || {};
        let codice = 'base';
        if (continuativa) {
          if ((s.cena && s.cena.r) || (s.hotel && s.hotel.r)) codice = 'base';
          else if (s.pranzo && s.pranzo.r) codice = 'media';
          else codice = 'piena';
        }
        risultato[d] = { catena: catena.id, continuativa, codice, giorniCatena: catena.giorni.length, fuori: catena.fuori, aperta };
      }
      catena = null;
    };
    for (let d = inizio; d <= fine; d = aggiungiGiorni(d, 1)) {
      const tipo = tipoGiorno(d, giorni, imp);
      const ruolo = tipo ? TIPI[tipo].ruolo : 'collega';
      if (ruolo === 'trasferta') {
        if (!catena) catena = { id: ++id, giorni: [], fuori: 0 };
        catena.giorni.push(d);
        if ((giorni[d].regione || 'in') === 'fuori') catena.fuori++;
      } else if (ruolo === 'reset') {
        chiudi(false);
      }
    }
    chiudi(true);
    return risultato;
  }

  function oreStraordinario(minuti, turnoOre, blocco) {
    const extra = minuti - turnoOre * 60;
    if (extra < blocco) return 0;
    return Math.floor(extra / blocco) * blocco / 60;
  }

  /* ------------------------------------------------------------------ */
  /* Voci variabili del mese                                             */
  /* ------------------------------------------------------------------ */
  // Ritorna l'elenco delle competenze e trattenute del mese, senza la parte fiscale.
  function vociMese(y, m, dati, impRaw) {
    const imp = normalizzaImpostazioni(impRaw);
    const giorni = (dati && dati.giorni) || {};
    const datiMese = ((dati && dati.mesi) || {})[chiaveMese(y, m)] || {};
    const gm = giorniNelMese(y, m);
    const da = iso(y, m, 1), a = iso(y, m, gm);
    const trasf = classificaTrasferte(giorni, imp, da, a);
    const avvisi = [];
    const comp = []; // { id, descr, rif, base, importo, soggetta, c10, c7 }
    const tratt = [];
    const info = [];
    const agg = {};
    const aggiungi = (chiave, voce, qta, importoUnit, totale) => {
      if (!agg[chiave]) agg[chiave] = Object.assign({ qta: 0, totale: 0, base: importoUnit }, voce);
      agg[chiave].qta += qta;
      agg[chiave].totale += totale;
    };

    // 1. Retribuzione fissa, ripartita per periodi (gestisce il cambio a metà mese).
    const quote = {};
    for (let d = 1; d <= gm; d++) {
      const p = periodoValido(imp, iso(y, m, d));
      const k = p.dal;
      if (!quote[k]) quote[k] = { p, giorni: 0 };
      quote[k].giorni++;
    }
    const periodiMese = Object.values(quote);
    let ivsPesata = 0, cigsPesata = 0, rinnovo = 0, pagaMedia = 0;
    for (const q of periodiMese) {
      const frazione = q.giorni / gm;
      const pm = pagaMensile(q.p);
      const importo = r2(pm * frazione);
      const descr = periodiMese.length > 1
        ? `Retribuzione (${q.p.percentualePaga}% dal ${q.p.dal.split('-').reverse().join('/')})`
        : 'Retribuzione';
      comp.push({ id: 'retribuzione', descr, base: periodiMese.length > 1 ? pm : r5(pm / imp.contratto.divisoreGiorni), rif: periodiMese.length > 1 ? `${q.giorni}/${gm} gg` : '', importo, soggetta: true });
      ivsPesata += q.p.aliquotaIVS * frazione;
      cigsPesata += q.p.aliquotaCIGS * frazione;
      rinnovo += (q.p.quotaRinnovo || 0) * frazione;
      pagaMedia += pm * frazione;
    }
    if (periodiMese.length > 1) avvisi.push('Mese con cambio di parametri contrattuali: retribuzione e contributi ripartiti a giorni (stima da verificare con la busta paga).');

    // 2. Giorni del mese.
    let buoni = 0, vuoti = 0, catenaAperta = false;
    let spesaTotale = 0, esubero = 0;
    const conteggio = { ufficio: 0, trasferta: 0, ferie: 0, permessoOre: 0, malattia: 0, festivita: 0, formazione: 0 };
    for (let d = 1; d <= gm; d++) {
      const data = iso(y, m, d);
      const rec = giorni[data] || {};
      const tipo = tipoGiorno(data, giorni, imp);
      const gs = giornoSettimana(data);
      const fest = festivita(data, imp);
      const p = periodoValido(imp, data);
      const oraria = pagaOraria(p, imp);
      if (!tipo) { vuoti++; continue; }
      if (tipo === 'permesso') conteggio.permessoOre += Number(rec.permessoOre || 8);
      else if (conteggio[tipo] !== undefined) conteggio[tipo]++;
      if (rec.permessoOre && tipo !== 'permesso') conteggio.permessoOre += Number(rec.permessoOre);

      if (TIPI[tipo].lavoro) {
        const minuti = Number(rec.minuti != null ? rec.minuti : (tipo === 'trasferta' ? imp.orari.turnoTrasferta : imp.orari.turnoUfficio) * 60);
        const giornoNonLavorativo = gs === 0 || gs === 6 || !!fest;
        if (giornoNonLavorativo) {
          const ore = Math.floor(minuti / imp.orari.bloccoMinuti) * imp.orari.bloccoMinuti / 60;
          const festivo = gs === 0 || !!fest;
          const perc = festivo ? imp.maggiorazioni.festivo : imp.maggiorazioni.sabato;
          const tariffa = r5(oraria * (1 + perc / 100));
          const c10 = festivo ? imp.maggiorazioni.agevolato15Festivo : imp.maggiorazioni.agevolato15Sabato;
          aggiungi(`magg-${festivo ? 'f' : 's'}-${tariffa}`, { id: festivo ? 'festivo' : 'sabato', descr: festivo ? `Lavoro festivo ${perc}%` : `Lavoro sabato ${perc}%`, unita: 'ORE', soggetta: true, c10 }, ore, tariffa, ore * tariffa);
        } else {
          const turno = tipo === 'trasferta' ? imp.orari.turnoTrasferta : imp.orari.turnoUfficio;
          const ore = oreStraordinario(minuti, turno, imp.orari.bloccoMinuti);
          if (ore > 0) {
            const o1 = Math.min(2, ore), o2 = ore - o1;
            const t1 = r5(oraria * (1 + imp.maggiorazioni.straordinarioPrime2 / 100));
            const t2 = r5(oraria * (1 + imp.maggiorazioni.straordinarioOltre / 100));
            const c10 = imp.maggiorazioni.agevolato15Straordinari;
            aggiungi(`str1-${t1}`, { id: 'straordinario', descr: `Straordinario ${imp.maggiorazioni.straordinarioPrime2}%`, unita: 'ORE', soggetta: true, c10 }, o1, t1, o1 * t1);
            if (o2 > 0) aggiungi(`str2-${t2}`, { id: 'straordinario', descr: `Straordinario ${imp.maggiorazioni.straordinarioOltre}%`, unita: 'ORE', soggetta: true, c10 }, o2, t2, o2 * t2);
          }
        }
      }

      if (tipo === 'ufficio' || (tipo === 'trasferta' && imp.buoniPasto.ancheInTrasferta)) buoni++;

      if (tipo === 'trasferta') {
        const c = trasf[data];
        if (c && c.aperta && !c.continuativa) catenaAperta = true;
        aggiungi('diaria', { id: 'diaria', descr: 'Diaria Italia soggetta', unita: 'GG', soggetta: true }, 1, imp.trasferte.diaria, imp.trasferte.diaria);
        const cod = c ? c.codice : 'base';
        const nomi = { base: 'Trasferta Italia es. 1/3 (Base)', media: 'Trasferta Italia es. 2/3 (Media)', piena: 'Trasferta Italia es. 3/3 (Piena)' };
        const ordine = { base: 1, media: 2, piena: 3 };
        aggiungi(`ind-${cod}`, { id: 'indennita', ordine: ordine[cod], descr: nomi[cod], unita: 'GG', soggetta: false }, 1, imp.trasferte[cod], imp.trasferte[cod]);
      }

      const s = rec.spese || {};
      const imp_ = (x) => (x && x.r ? Number(x.importo || 0) : 0);
      const col = imp_(s.colazione), pr = imp_(s.pranzo), ce = imp_(s.cena), ho = imp_(s.hotel);
      spesaTotale += col + pr + ce + ho;
      esubero += Math.max(0, pr - imp.trasferte.maxPranzo) + Math.max(0, ce - imp.trasferte.maxCena);
    }
    for (const v of Object.values(agg).sort((a, b) => (a.ordine || 0) - (b.ordine || 0))) {
      comp.push({ id: v.id, descr: v.descr, base: v.base, rif: `${fmtNum(v.qta)} ${v.unita}`, importo: r2(v.totale), soggetta: v.soggetta, c10: !!v.c10 });
    }
    if (vuoti > 0) avvisi.push(`${vuoti} giorni feriali non compilati: il calcolo li considera retribuiti ma senza voci variabili.`);
    if (catenaAperta) avvisi.push('Una trasferta a fine mese non è ancora continuativa: se prosegue nel mese successivo, il tipo di indennità può cambiare.');

    // 3. Una tantum ricorrenti e voci manuali del mese.
    for (const u of imp.unaTantumRicorrenti || []) {
      if (Number(u.mese) === m && Number(u.importo)) comp.push({ id: 'unatantum', descr: u.descrizione, rif: '', importo: r2(Number(u.importo)), soggetta: true });
    }
    for (const v of datiMese.voci || []) {
      const importo = r2(Number(v.importo || 0));
      if (!importo) continue;
      if (v.tipo === 'trattenuta') tratt.push({ id: 'manuale', descr: v.descrizione || 'Trattenuta', importo });
      else comp.push({ id: 'manuale', descr: v.descrizione || 'Competenza', rif: '', importo, soggetta: v.soggetta !== false });
    }
    if (esubero > 0) tratt.push({ id: 'esubero', descr: 'Trattenuta rimborso spese (oltre massimali)', importo: r2(esubero) });

    // 4. Informative (non entrano nel netto).
    if (buoni) info.push({ descr: 'Buoni pasto elettronici', rif: `${buoni} GG × ${fmtNum(imp.buoniPasto.valore)} €`, importo: r2(buoni * imp.buoniPasto.valore) });
    if (spesaTotale) info.push({ descr: 'Spese pagate con carta aziendale', rif: '', importo: r2(spesaTotale) });

    return {
      imp, comp, tratt, info, avvisi, trasf, conteggio, buoni,
      aliquotaIVS: ivsPesata, aliquotaCIGS: cigsPesata, quotaRinnovo: rinnovo, pagaMedia, giorniMese: gm,
    };
  }

  function fmtNum(n) {
    return Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  }

  /* ------------------------------------------------------------------ */
  /* Calcolo fiscale del mese                                            */
  /* ------------------------------------------------------------------ */
  function calcolaMese(y, m, dati, impRaw, opzioni) {
    opzioni = opzioni || {};
    const v = vociMese(y, m, dati, impRaw);
    const imp = v.imp;
    const reg = regoleAnno(y);
    const comp = v.comp.slice();
    const tratt = [];
    const avvisi = v.avvisi.slice();
    const det = {};

    const soggette = comp.filter((c) => c.soggetta).reduce((s, c) => s + c.importo, 0);
    const c10Lordo = comp.filter((c) => c.soggetta && c.c10).reduce((s, c) => s + c.importo, 0);
    const esenti = comp.filter((c) => !c.soggetta).reduce((s, c) => s + c.importo, 0);

    // Contributi INPS
    const ivs = v.aliquotaIVS, cigs = v.aliquotaCIGS;
    const impInps = Math.round(soggette);
    const cIvs = r2(impInps * ivs / 100), cCigs = r2(impInps * cigs / 100);
    tratt.push({ id: 'ivs', descr: 'Contributo IVS', base: impInps, rif: `${fmtNum(r2(ivs))} %`, importo: cIvs });
    tratt.push({ id: 'cigs', descr: 'Contributo CIGS', base: impInps, rif: `${fmtNum(r2(cigs))} %`, importo: cCigs });
    const k = 1 - (ivs + cigs) / 100;

    // Imposte sostitutive L.199/25
    const baseC7 = r2(v.quotaRinnovo * k);
    // Tetto annuo agevolazione 15%
    let c10Disponibile = Infinity;
    if (reg.tettoMaggiorazioni15 && !opzioni.senzaTetto) {
      let usato = 0;
      for (let mm = 1; mm < m; mm++) {
        const vv = vociMese(y, mm, dati, imp);
        usato += vv.comp.filter((c) => c.soggetta && c.c10).reduce((s, c) => s + c.importo, 0);
      }
      c10Disponibile = Math.max(0, reg.tettoMaggiorazioni15 - usato);
    }
    const c10Agevolato = Math.min(c10Lordo, c10Disponibile);
    if (c10Lordo > c10Agevolato) avvisi.push('Superato il tetto annuo delle maggiorazioni a tassazione agevolata (15%): l\'eccedenza è tassata con IRPEF ordinaria.');
    const baseC10 = r2(c10Agevolato * k);
    const sostC7 = r2(baseC7 * reg.sostitutivaRinnovi / 100);
    const sostC10 = r2(baseC10 * reg.sostitutivaMaggiorazioni / 100);

    // IRPEF del mese
    let impIrpef = r2(soggette - cIvs - cCigs - baseC7 - baseC10);
    const Rstima = impIrpef * 12;
    const pctEsente = percentualeSommaEsente(Rstima);
    if (pctEsente) {
      const esente = r2(impIrpef * pctEsente / 100);
      impIrpef = r2(impIrpef - esente);
      det.sommaEsente = esente;
    }
    const irpefLorda = r2(impostaScaglioni(impIrpef, reg.scaglioni, reg.divisoreMensile));
    const gg = v.giorniMese;
    const detrLav = r2(detrazioneLavoroDipendente(Rstima) * gg / 365);
    const ultDetr = r2(ulterioreDetrazione(Rstima) * gg / 365);
    const ritenute = r2(Math.max(0, irpefLorda - detrLav - ultDetr));
    Object.assign(det, { impInps, impIrpef, irpefLorda, detrLav, ultDetr, ritenute, baseC7, baseC10, sostC7, sostC10, soggette, esenti, Rstima });

    tratt.push({ id: 'irpef', descr: 'Ritenute IRPEF', importo: ritenute });
    if (sostC7) tratt.push({ id: 'sost7', descr: 'Imposta sostitutiva rinnovi 5% (L.199/25 c.7)', base: baseC7, importo: sostC7 });
    if (sostC10) tratt.push({ id: 'sost10', descr: 'Imposta sostitutiva maggiorazioni 15% (L.199/25 c.10)', base: baseC10, importo: sostC10 });

    // Tredicesima e conguaglio
    let tredicesima = null, conguaglio = null;
    if (m === imp.contratto.meseTredicesima && !opzioni.senzaTredicesima) {
      let ratei = 0;
      for (let mm = 1; mm <= 12; mm++) {
        const gmm = giorniNelMese(y, mm);
        let pm = 0;
        for (let d = 1; d <= gmm; d++) pm += pagaMensile(periodoValido(imp, iso(y, mm, d))) / gmm;
        ratei += pm / 12;
      }
      const lordo13 = r2(ratei);
      const c13 = r2(lordo13 * (ivs + cigs) / 100);
      const imp13 = r2(lordo13 - c13);
      const irpef13 = r2(impostaScaglioni(imp13, reg.scaglioni, reg.divisoreMensile));
      tredicesima = { lordo: lordo13, contributi: c13, imponibile: imp13, irpef: irpef13 };
      comp.push({ id: 'tredicesima', descr: 'Tredicesima mensilità', rif: '', importo: lordo13, soggetta: true, separata: true });
      tratt.push({ id: 'contr13', descr: 'Contributi su tredicesima', importo: c13 });
      tratt.push({ id: 'irpef13', descr: 'IRPEF su tredicesima', importo: irpef13 });
      avvisi.push('Mese con tredicesima e conguaglio fiscale di fine anno: stima meno precisa.');

      if (!opzioni.senzaConguaglio) {
        const prog = imp.progressivi || {};
        let impAnno = 0, pagata = 0, meseDa = 1, mancanti = 0;
        if (prog.mese && prog.mese.startsWith(String(y))) {
          impAnno = Number(prog.imponibileIrpef || 0);
          pagata = Number(prog.irpefPagata || 0);
          meseDa = Number(prog.mese.slice(5)) + 1;
        }
        for (let mm = meseDa; mm < m; mm++) {
          const r = calcolaMese(y, mm, dati, imp, { senzaConguaglio: true });
          if (r.vuoti) mancanti++;
          impAnno += r.dettaglio.impIrpef;
          pagata += r.dettaglio.ritenute;
        }
        impAnno += impIrpef + imp13;
        pagata += ritenute + irpef13;
        const lordaAnno = impostaScaglioni(impAnno, reg.scaglioni, 1);
        const dovuta = Math.max(0, lordaAnno - detrazioneLavoroDipendente(impAnno) - ulterioreDetrazione(impAnno));
        const diff = r2(dovuta - pagata);
        conguaglio = { imponibileAnno: r2(impAnno), dovuta: r2(dovuta), pagata: r2(pagata), differenza: diff };
        if (diff > 0) tratt.push({ id: 'conguaglio', descr: 'Conguaglio IRPEF di fine anno (a debito)', importo: diff });
        else if (diff < 0) comp.push({ id: 'conguaglio', descr: 'Conguaglio IRPEF di fine anno (a credito)', rif: '', importo: -diff, soggetta: false, fiscale: true });
        if (mancanti) avvisi.push(`Conguaglio stimato con ${mancanti} mesi dell'anno incompleti: inserisci i progressivi della busta paga nelle impostazioni per una stima migliore.`);
      }
    }

    // Addizionali (rate impostate a mano)
    for (const a of imp.addizionali || []) {
      if (Number(a.anno) === y && m >= Number(a.daMese) && m <= Number(a.aMese) && Number(a.rata)) {
        tratt.push({ id: 'addizionale', descr: a.descrizione, importo: r2(Number(a.rata)) });
      }
    }

    tratt.push(...v.tratt);

    const totComp = r2(comp.reduce((s, c) => s + c.importo, 0));
    const totTratt = r2(tratt.reduce((s, t) => s + t.importo, 0));
    const lordo = r2(comp.filter((c) => !c.fiscale).reduce((s, c) => s + c.importo, 0));
    const netto = r2(totComp - totTratt);
    const vuoti = /giorni feriali non compilati/.test(v.avvisi.join(' '));

    const accredito = (() => {
      const g = imp.contratto.giornoAccredito || 15;
      const yy = m === 12 ? y + 1 : y, mm = m === 12 ? 1 : m + 1;
      return iso(yy, mm, Math.min(g, giorniNelMese(yy, mm)));
    })();

    return {
      anno: y, mese: m, competenze: comp, trattenute: tratt, informative: v.info, avvisi,
      totali: { competenze: totComp, trattenute: totTratt, lordo, netto },
      dettaglio: det, tredicesima, conguaglio, trasferte: v.trasf, conteggio: v.conteggio,
      accredito, vuoti,
    };
  }

  return {
    r2, iso, pad, giorniNelMese, giornoSettimana, aggiungiGiorni, chiaveMese, unisciProfondo, clona,
    REGOLE_FISCALI, regoleAnno, impostaScaglioni, detrazioneLavoroDipendente, ulterioreDetrazione,
    IMPOSTAZIONI_DEFAULT, normalizzaImpostazioni, periodoValido, pagaMensile, pagaOraria,
    festivita, pasqua, TIPI, tipoGiorno, classificaTrasferte, oreStraordinario,
    vociMese, calcolaMese, fmtNum,
  };
});
