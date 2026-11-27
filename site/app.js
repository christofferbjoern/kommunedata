/* Kommuneblik – statisk side, der læser data/data.json og data/kort.json */
{
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('kb-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kb-' + k, JSON.stringify(v)); } catch (e) { /* ingen lagring */ } }
  };

  let D = null, KORT = null, KODER = [], K = {};
  const state = {
    view: 'overblik', kode: store.get('kode', '101'), kortMaal: store.get('kortMaal', 'vaekst'), kortAar: null,
    sml: store.get('sml', null), rangMaal: store.get('rangMaal', 'erhvervsindk'), rangAar: null,
    budgetQ: '', budgetF: 'alle', sort: { col: 'bef', dir: -1 }, zoom: false
  };

  const DIV = new Set(['vaekst', 'foedselsoverskud', 'nettotilflytning', 'udligpr']);
  const SUM = new Set(['bef', 'areal']);
  const UDENKURVE = new Set(['areal']);  // ændres kun ved små opmålingsjusteringer
  const ORDEN = ['bef', 'vaekst', 'andel0_17', 'andel65', 'foedselsoverskud', 'nettotilflytning', 'andel_indv', 'areal', 'taethed',
    'beskfrek', 'erhvfrek', 'ledighed', 'andel_landbrug', 'andel_industri', 'andel_offentlig',
    'erhvervsindk', 'dispindk', 'videregaaende', 'lvu', 'erhvervsfaglig', 'grundskole',
    'driftpr', 'budgetdriftpr', 'anlaegpr', 'skatpr', 'udligpr', 'skattepct', 'grundskyld',
    'ng_service', 'ng_gaeld', 'ng_aeldre', 'ng_folkeskole', 'ng_dagtilbud', 'ng_sundhed', 'ng_kultur', 'ng_transport', 'ng_arbejdsmarked'];
  const KATEGORIER = ['Befolkning', 'Geografi', 'Beskæftigelse', 'Erhverv', 'Indkomst', 'Uddannelse', 'Økonomi', 'Kommunale nøgletal'];
  const NOEGLE = ['bef', 'vaekst', 'taethed', 'beskfrek', 'ledighed', 'erhvervsindk', 'videregaaende', 'skattepct', 'driftpr'];
  const SERIE = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];

  const NF = {};
  const nf = d => NF[d] || (NF[d] = new Intl.NumberFormat('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const ENHED = { 'kr.': ' kr.', 'pct.': ' pct.', 'personer': '', 'km²': ' km²', 'indb. pr. km²': ' pr. km²', 'pr. 1.000': ' pr. 1.000',
    'promille': ' ‰', 'pr. 100': ' pr. 100', 'pct. af arbejdsstyrken': ' pct.' };
  const fmt = (v, m, enhed = true) => (v == null || isNaN(v)) ? '–' : nf(m.decimaler).format(v) + (enhed ? (ENHED[m.enhed] ?? ' ' + m.enhed) : '');
  const fmtTick = (v, dec) => Math.abs(v) >= 1e6 ? nf(Math.abs(v) >= 1e7 ? 0 : 1).format(v / 1e6) + ' mio.' : nf(dec).format(v);
  const pctEnhed = m => /pct|promille|pr\. 1\.000|pr\. 100/.test(m.enhed);

  /* ---------- dataadgang ---------- */
  const maalListe = () => ORDEN.filter(k => D.maal[k]).concat(Object.keys(D.maal).filter(k => !ORDEN.includes(k)));
  const val = (m, kode, aar) => { const i = m.aar.indexOf(aar); const a = m.v[kode]; return i < 0 || !a ? null : a[i]; };
  const seneste = (m, kode) => { const a = m.v[kode]; if (a) for (let i = a.length - 1; i >= 0; i--) if (a[i] != null) return [m.aar[i], a[i]]; return [null, null]; };
  const vaerdier = (m, aar) => KODER.map(k => [k, val(m, k, aar)]).filter(x => x[1] != null);
  const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  function sidsteAar(m) {
    for (let i = m.aar.length - 1; i >= 0; i--) { let n = 0; for (const k of KODER) if (m.v[k] && m.v[k][i] != null) n++; if (n >= 80) return m.aar[i]; }
    return m.aar[m.aar.length - 1];
  }
  function ref(m) {
    if (m.v['000']) return { navn: 'Hele landet', vals: m.v['000'] };
    return { navn: 'Mediankommune', vals: m.aar.map(a => median(vaerdier(m, a).map(x => x[1]))) };
  }
  const refVal = (m, aar) => { const r = ref(m); const i = m.aar.indexOf(aar); return i < 0 ? null : r.vals[i]; };
  function rang(m, kode, aar) {
    const vs = vaerdier(m, aar).sort((a, b) => b[1] - a[1]); const i = vs.findIndex(x => x[0] === kode);
    return i < 0 ? null : [i + 1, vs.length];
  }
  function aendring(m, kode, aar) {
    const i = m.aar.indexOf(aar); const a = m.v[kode]; if (!a || i < 1) return null;
    let j = i - 1; while (j >= 0 && a[j] == null) j--; if (j < 0 || a[i] == null) return null;
    return { fra: m.aar[j], d: pctEnhed(m) || DIV.has(m.key) ? a[i] - a[j] : (a[i] / a[j] - 1) * 100, pp: pctEnhed(m) || DIV.has(m.key) };
  }
  function deltaHTML(m, kode, aar) {
    const c = aendring(m, kode, aar); if (!c || !isFinite(c.d)) return '';
    const sign = c.d > 0 ? '+' : c.d < 0 ? '−' : '±';
    const tekst = c.pp ? `${sign}${nf(m.decimaler || 1).format(Math.abs(c.d))} ${pctEnhed(m) ? 'point' : ''}` : `${sign}${nf(1).format(Math.abs(c.d))} %`;
    const god = m.retning * c.d; const cls = !m.retning || Math.abs(c.d) < 1e-9 ? '' : god > 0 ? 'up' : 'down';
    return `<span class="${cls}">${esc(tekst.trim())}</span> siden ${c.fra}`;
  }
  const regionKort = r => (r || '').replace('Region ', '');

  /* ---------- tooltip ---------- */
  const tip = $('#tip');
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function visTip(x0, y0, build) {
    tip.replaceChildren(); build(tip); tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    let x = x0 + 14, y = y0 + 14;
    if (x + r.width > innerWidth - 8) x = x0 - r.width - 14;
    if (y + r.height > innerHeight - 8) y = y0 - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const skjulTip = () => { tip.style.display = 'none'; };

  /* ---------- kort ---------- */
  let hovedBox = null;
  function bbox(koder) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const k of koder) {
      const d = KORT.stier[k]; if (!d) continue;
      for (const mm of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) { const x = +mm[1], y = +mm[2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    const p = 12; return [x0 - p, y0 - p, x1 - x0 + 2 * p, y1 - y0 + 2 * p];
  }
  function kortSVG(klasse, opts = {}) {
    const vb = opts.zoom ? hovedBox : KORT.viewBox;
    const b = KORT.bornholmBoks;
    const paths = KODER.filter(k => KORT.stier[k]).map(k =>
      `<path d="${KORT.stier[k]}" class="${klasse(k)}${k === opts.sel ? ' sel' : ''}" data-k="${k}" tabindex="${opts.fokus ? 0 : -1}" aria-label="${esc(K[k].navn)}"></path>`).join('');
    const inset = !opts.zoom && b ? `<rect class="inset" x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" rx="6"></rect>` : '';
    return `<svg viewBox="${vb.join(' ')}" role="img" aria-label="${esc(opts.label || 'Kort over kommunerne')}" preserveAspectRatio="xMidYMid meet">${inset}${paths}</svg>`;
  }
  function klasser(m, aar) {
    const vs = vaerdier(m, aar).map(x => x[1]);
    if (!vs.length) return { klasse: () => 'cna', legend: [] };
    if (DIV.has(m.key)) {
      const neg = vs.filter(v => v < 0).map(Math.abs), pos = vs.filter(v => v > 0);
      const nb = 0.15 * (median(vs.map(Math.abs)) || 0);
      const mn = median(neg.filter(v => v > nb)) ?? nb, mp = median(pos.filter(v => v > nb)) ?? nb;
      const kl = v => v == null ? 'cna' : Math.abs(v) <= nb ? 'd0' : v < 0 ? (-v > mn ? 'dn2' : 'dn1') : (v > mp ? 'dp2' : 'dp1');
      const f = v => fmt(v, m);
      return {
        klasse: kl, legend: [['dn2', `under −${f(mn)}`], ['dn1', `−${f(mn)} til −${f(nb)}`], ['d0', `omkring 0 (±${f(nb)})`],
          ['dp1', `${f(nb)} til ${f(mp)}`], ['dp2', `over ${f(mp)}`]]
      };
    }
    const s = [...vs].sort((a, b) => a - b); const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const br = [q(.2), q(.4), q(.6), q(.8)];
    const kl = v => v == null ? 'cna' : 'c' + br.filter(b => v >= b).length;
    const f = v => fmt(v, m);
    return { klasse: kl, legend: [['c0', `under ${f(br[0])}`], ['c1', `${f(br[0])}–${f(br[1])}`], ['c2', `${f(br[1])}–${f(br[2])}`], ['c3', `${f(br[2])}–${f(br[3])}`], ['c4', `${f(br[3])} og derover`]] };
  }
  function bindKort(box, m, aar, onClick) {
    const svg = box.querySelector('svg');
    const vis = (e, k, x, y) => {
      visTip(x, y, t => {
        t.append(mk('div', null, K[k].navn));
        if (m) {
          const v = val(m, k, aar); t.append(mk('div', 'tv', fmt(v, m)));
          const r = rang(m, k, aar); if (r) t.append(mk('div', 'muted small', `Nr. ${r[0]} af ${r[1]} · ${aar}`));
        }
      });
    };
    svg.addEventListener('pointermove', e => { const k = e.target.dataset && e.target.dataset.k; if (k) vis(e, k, e.clientX, e.clientY); else skjulTip(); });
    svg.addEventListener('pointerleave', skjulTip);
    svg.addEventListener('focusin', e => { const k = e.target.dataset.k; if (k) { const r = e.target.getBoundingClientRect(); vis(e, k, r.right, r.top); } });
    svg.addEventListener('focusout', skjulTip);
    svg.addEventListener('click', e => { const k = e.target.dataset && e.target.dataset.k; if (k && onClick) onClick(k); });
    svg.addEventListener('keydown', e => { const k = e.target.dataset && e.target.dataset.k; if (k && e.key === 'Enter' && onClick) onClick(k); });
  }

  /* ---------- linjediagram ---------- */
  let observers = [];
  function ticks(lo, hi, n) {
    if (lo === hi) { const d = Math.abs(lo) * 0.05 || 1; lo -= d; hi += d; }
    const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0)), f = step0 / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const t = []; for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) t.push(+v.toFixed(10));
    return { t, step };
  }
  function linje(fig, cfg) {
    const { aar, serier, m } = cfg;
    let cur = null;
    const draw = () => {
      const W = fig.clientWidth, H = fig.clientHeight; if (!W || !H) return;
      let i0 = aar.length, i1 = -1;
      serier.forEach(s => s.vals.forEach((v, i) => { if (v != null) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); } }));
      if (i1 < 0) { fig.innerHTML = '<p class="empty">Ingen tal for denne kommune.</p>'; return; }
      const alle = serier.flatMap(s => s.vals.slice(i0, i1 + 1).filter(v => v != null));
      let lo = Math.min(...alle), hi = Math.max(...alle);
      if (DIV.has(m.key)) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      const { t, step } = ticks(lo, hi, H < 210 ? 3 : 4);
      const dec = Math.max(0, Math.min(2, -Math.floor(Math.log10(step) + 1e-9)));
      const lab = t.map(v => fmtTick(v, dec));
      const smal = W < 520;
      const s0 = serier[0]; let eI = -1; s0.vals.forEach((v, i) => { if (v != null && i <= i1) eI = i; });
      const endTxt = eI >= 0 && !smal ? fmt(s0.vals[eI], m, false) : '';
      const padL = Math.max(...lab.map(s => s.length)) * 7.2 + 12, padR = endTxt ? endTxt.length * 7.6 + 16 : 14, padT = 12, padB = 26;
      const pw = W - padL - padR, ph = H - padT - padB, t0 = t[0], tN = t[t.length - 1];
      const x = i => padL + (i1 === i0 ? pw / 2 : (i - i0) / (i1 - i0) * pw);
      const y = v => padT + (1 - (v - t0) / (tN - t0)) * ph;
      let g = '';
      t.forEach((v, j) => { g += `<line class="${v === 0 && DIV.has(m.key) ? 'base' : 'grid'}" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"></line><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${esc(lab[j])}</text>`; });
      g += `<line class="base" x1="${padL}" x2="${W - padR}" y1="${padT + ph}" y2="${padT + ph}"></line>`;
      const stride = Math.max(1, Math.ceil(46 / (pw / Math.max(1, i1 - i0))));
      for (let i = i0; i <= i1; i++) if ((i1 - i) % stride === 0) g += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${aar[i]}</text>`;
      serier.slice().reverse().forEach(s => {
        let d = '', pen = false;
        for (let i = i0; i <= i1; i++) { const v = s.vals[i]; if (v == null) { pen = false; continue; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; }
        g += `<path class="ln" d="${d}" style="stroke:${s.farve}"></path>`;
        const enkelt = s.vals.slice(i0, i1 + 1).filter(v => v != null).length === 1;
        if (enkelt) s.vals.forEach((v, i) => { if (v != null) g += `<circle class="dot" r="4.5" cx="${x(i)}" cy="${y(v)}" style="fill:${s.farve}"></circle>`; });
      });
      if (eI >= 0) {
        g += `<circle class="dot" r="4.5" cx="${x(eI)}" cy="${y(s0.vals[eI])}" style="fill:${s0.farve}"></circle>`;
        if (endTxt) g += `<text class="end" x="${x(eI) + 9}" y="${y(s0.vals[eI]) + 4}">${esc(endTxt)}</text>`;
      }
      g += `<g class="hov"></g><rect x="${padL - 6}" y="${padT}" width="${pw + 12}" height="${ph}" fill="transparent" class="hit"></rect>`;
      fig.innerHTML = `<svg tabindex="0" role="img" aria-label="${esc(cfg.label || m.navn)}">${g}</svg>`;
      const svg = fig.firstChild, hov = svg.querySelector('.hov');
      const vis = (i, cx, cy) => {
        cur = i;
        let h = `<line class="cross" x1="${x(i)}" x2="${x(i)}" y1="${padT}" y2="${padT + ph}"></line>`;
        serier.forEach(s => { const v = s.vals[i]; if (v != null) h += `<circle class="dot" r="4.5" cx="${x(i)}" cy="${y(v)}" style="fill:${s.farve}"></circle>`; });
        hov.innerHTML = h;
        visTip(cx, cy, tt => {
          tt.append(mk('div', 'muted small', String(aar[i])));
          serier.forEach(s => {
            const r = mk('div', 'tr'); const k = mk('i'); k.style.background = s.farve;
            r.append(k, mk('span', 'tv', fmt(s.vals[i], m)), mk('span', 'muted', s.navn)); tt.append(r);
          });
        });
      };
      const fra = e => { const r = svg.getBoundingClientRect(); const px = e.clientX - r.left; return Math.max(i0, Math.min(i1, Math.round(i0 + (px - padL) / (pw || 1) * (i1 - i0)))); };
      svg.addEventListener('pointermove', e => vis(fra(e), e.clientX, e.clientY));
      svg.addEventListener('pointerleave', () => { hov.innerHTML = ''; skjulTip(); });
      svg.addEventListener('blur', () => { hov.innerHTML = ''; skjulTip(); });
      svg.addEventListener('keydown', e => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault(); const i = Math.max(i0, Math.min(i1, (cur ?? i1) + (e.key === 'ArrowLeft' ? -1 : 1)));
        const r = svg.getBoundingClientRect(); vis(i, r.left + x(i), r.top + padT);
      });
    };
    const ro = new ResizeObserver(draw); ro.observe(fig); observers.push(ro);
  }
  function tabelHTML(aar, serier, m) {
    const rows = aar.map((a, i) => serier.some(s => s.vals[i] != null) ? `<tr><td>${a}</td>${serier.map(s => `<td class="num">${esc(fmt(s.vals[i], m))}</td>`).join('')}</tr>` : '').join('');
    return `<details class="tbl"><summary>Vis tallene</summary><div class="scroll"><table><thead><tr><th>År</th>${serier.map(s => `<th class="num">${esc(s.navn)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }
  const legendHTML = serier => serier.length < 2 ? '' : `<div class="legend">${serier.map(s => `<span><i class="line" style="background:${s.farve}"></i>${esc(s.navn)}</span>`).join('')}</div>`;
  function chartCard(id, m, titel, sub, serier) {
    return `<div class="chart"><h3>${esc(titel)}</h3><p class="sub">${sub}</p>${legendHTML(serier)}<div class="fig" id="${id}"></div>${tabelHTML(m.aar, serier, m)}</div>`;
  }

  /* ---------- fliser ---------- */
  function tile(m, kode, visRang) {
    const aar = kode === '000' && !m.v['000'] ? sidsteAar(m) : (seneste(m, kode)[0] ?? sidsteAar(m));
    const v = kode === '000' ? refVal(m, aar) : val(m, kode, aar);
    const r = visRang ? rang(m, kode, aar) : null;
    const lbl = kode === '000' && !m.v['000'] ? `${m.navn} (median)` : m.navn;
    const d = kode === '000' && !m.v['000'] ? '' : deltaHTML(m, kode, aar);
    return `<div class="tile"><div class="l">${esc(lbl)}, ${aar}</div><div class="fig-num">${esc(fmt(v, m))}</div><div class="d">${d}${r ? `${d ? ' · ' : ''}nr. ${r[0]} af ${r[1]}` : ''}</div></div>`;
  }

  /* ---------- budget ---------- */
  function skatType(b) {
    const t = (b.skat || '').toLowerCase();
    if (/ingen skattestigning|uændr|fasthold|holdes i ro|i ro/.test(t)) return 'uændret';
    if (/hæv|stig|forhøj|øges/.test(t)) return 'hæves';
    if (/sænk|nedsæt/.test(t)) return 'sænkes';
    return 'ikke nævnt';
  }
  const listeHTML = (xs, n) => xs && xs.length ? `<ol>${xs.slice(0, n).map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="muted small">Ikke angivet.</p>';
  function budgetHTML(kode) {
    const b = D.budget2027[kode];
    if (!b) return '<p class="muted">Vi har endnu ingen analyse af kommunens budgetaftale for 2027.</p>';
    const links = (b.links || []).filter(u => /^https?:\/\//.test(u)).map((u, i) => `<a href="${esc(u)}" rel="noopener">Kilde ${i + 1}</a>`).join('');
    return `<div class="budget">
      <p>${esc(b.resume)}</p>
      <p><span class="tag red">Skat: ${esc(skatType(b))}</span>${(b.partier || []).slice(0, 9).map(p => `<span class="tag">${esc(p)}</span>`).join('')}</p>
      <div class="cols">
        <div><h4>Største prioriteter</h4>${listeHTML(b.prioriteter, 5)}</div>
        <div><h4>Besparelser</h4>${listeHTML(b.besparelser, 5)}</div>
        <div><h4>Finansiering</h4>${listeHTML(b.finansiering, 4)}<h4>Skat og klima</h4><p class="small">${esc(b.skat || 'Ikke nævnt')}. ${esc(b.klima || '')}</p></div>
      </div>
      <p class="small muted">${esc(b.kvalitet || '')} · Budgetperiode ${esc(b.budgetaar || '2027')}</p>
      <p class="links">${links}</p></div>`;
  }

  /* ---------- udgiftsfordeling ---------- */
  function fordeling(kode) {
    const f = D.udgiftsfordeling[kode]; if (!f) return null;
    const aar = Object.keys(f).sort().pop(); const v = f[aar];
    const navne = ['Byudvikling, miljø og forsyning', ...D.hovedkonti.slice(2)];
    const vals = [v[0] + v[1], ...v.slice(2)];
    return { aar, navne, vals };
  }
  function segHTML(titel, fd) {
    const tot = fd.vals.reduce((a, b) => a + Math.max(0, b), 0);
    const blocks = fd.vals.map((v, i) => {
      const p = Math.max(0, v) / tot * 100; if (p <= 0) return '';
      return `<div class="${i === 3 ? 'dk' : ''}" style="flex:${p} 1 0;background:${SERIE[i]}" title="${esc(fd.navne[i])}: ${esc(nf(0).format(v))} kr.">${p >= 9 ? nf(0).format(p) + '%' : ''}</div>`;
    }).join('');
    return `<div class="seglab">${esc(titel)} · ${esc(nf(0).format(tot))} kr. pr. indbygger</div><div class="seg" role="img" aria-label="${esc(titel)}">${blocks}</div>`;
  }

  /* ---------- erhvervsstruktur (RAS301) ---------- */
  function erhvervHTML(kode) {
    const E = D.erhverv; if (!E || !E.v || !E.v[kode]) return '';
    const a = E.v[kode], l = E.v['000'] || [], navn = K[kode].navn;
    const hi = Math.max(...a, ...l) || 1;
    const p = x => nf(1).format(x) + ' pct.';
    const rk = E.grupper.map((g, i) => `<div class="row br"><span>${esc(g)}</span><span class="track"><b style="left:0;width:${Math.max(a[i] / hi * 100, .4)}%"></b>${l[i] != null ? `<span class="med" style="left:${l[i] / hi * 100}%"></span>` : ''}</span><span class="v">${esc(p(a[i]))}</span></div>`).join('');
    return `<div class="chart" style="grid-column:1/-1"><h3>Hvor arbejder borgerne? ${esc(E.aar)}</h3><p class="sub">Beskæftigede med bopæl i ${esc(navn)} fordelt på brancher, i procent. Stregen viser hele landet.</p>
      <div class="rows">${rk}</div>
      <div class="legend"><span><i style="background:var(--s1)"></i>${esc(navn)}</span><span><i class="mk"></i>Hele landet</span></div>
      <details class="tbl"><summary>Vis tallene</summary><div class="scroll"><table><thead><tr><th>Branche</th><th class="num">${esc(navn)}</th><th class="num">Hele landet</th></tr></thead><tbody>${E.grupper.map((g, i) => `<tr><td>${esc(g)}</td><td class="num">${esc(p(a[i]))}</td><td class="num">${l[i] != null ? esc(p(l[i])) : '–'}</td></tr>`).join('')}</tbody></table></div></details></div>`;
  }

  /* ---------- visninger ---------- */
  const main = $('#main');
  function setView(v) {
    observers.forEach(o => o.disconnect()); observers = []; skjulTip();
    state.view = v;
    document.querySelectorAll('nav.tabs a').forEach(a => { if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }

  function overblik() {
    setView('overblik');
    const mb = D.maal.bef, mv = D.maal.vaekst;
    const ba = sidsteAar(mb), land = val(mb, '000', ba);
    const va = mv ? sidsteAar(mv) : null;
    const vs = mv ? vaerdier(mv, va).sort((a, b) => b[1] - a[1]) : [];
    const voks = vs.filter(x => x[1] > 0).length;
    const titel = `${nf(0).format(land)} indbyggere i 98 kommuner – ${voks} af dem voksede sidste år`;
    const sub = mv ? `Befolkningen ændrede sig ${fmt(val(mv, '000', va), mv)} fra 1. januar ${va - 1} til 1. januar ${va}. Størst vækst: ${esc(K[vs[0][0]].navn)} (${fmt(vs[0][1], mv)}). Størst fald: ${esc(K[vs[vs.length - 1][0]].navn)} (${fmt(vs[vs.length - 1][1], mv)}).` : '';
    const liste = maalListe();
    if (!D.maal[state.kortMaal]) state.kortMaal = liste[0];
    main.innerHTML = `
      <section class="band"><div class="wrap">
        <h2>${esc(titel)}</h2><p class="muted">${sub}</p>
        <div class="tiles">${NOEGLE.filter(k => D.maal[k]).map(k => tile(D.maal[k], '000', false)).join('')}</div>
        <p class="small muted">Landstal, eller mediankommunen hvor DST ikke giver et landstal. Ændringer i procent eller procentpoint siden året før.</p>
      </div></section>
      <section class="band"><div class="wrap split">
        <div>
          <div class="filters">
            <label for="kmaal">Vis på kortet<select id="kmaal">${KATEGORIER.map(c => `<optgroup label="${c}">${liste.filter(k => D.maal[k].kategori === c).map(k => `<option value="${k}">${esc(D.maal[k].navn)}</option>`).join('')}</optgroup>`).join('')}</select></label>
            <label for="kaar">År<select id="kaar"></select></label>
          </div>
          <div class="mapbox" id="kort"></div>
          <div class="legend" id="klegend"></div>
        </div>
        <div class="panel"><h3 id="toptitel"></h3><p class="small muted" id="topsub"></p><div class="rows" id="top"></div><h3 style="margin-top:18px">Laveste</h3><div class="rows" id="bund"></div></div>
      </div></section>
      <section class="band"><div class="wrap"><h3>Alle 98 kommuner</h3><p class="small muted">Seneste år for hvert mål. Klik på en overskrift for at sortere og på et navn for at se kommunen.</p><div class="scroll"><table id="alle"></table></div></div></section>`;
    $('#kmaal').value = state.kortMaal;
    $('#kmaal').addEventListener('change', e => { state.kortMaal = e.target.value; state.kortAar = null; store.set('kortMaal', state.kortMaal); tegnKort(); });
    $('#kaar').addEventListener('change', e => { state.kortAar = +e.target.value; tegnKort(); });
    tegnKort(); tegnAlle();
  }
  function rowHTML(m, k, v, n, lo, hi, med, me) {
    const span = hi - lo || 1, z = (0 - lo) / span * 100, w = Math.abs(v) / span * 100;
    const left = v >= 0 ? z : z - w;
    return `<a class="row${me ? ' me' : ''}" href="#kommune-${k}"><span class="n">${n}</span><span>${esc(K[k].navn)}</span><span class="track">${lo < 0 ? `<span class="zero" style="left:${z}%"></span>` : ''}<b class="${v < 0 ? 'neg' : ''}" style="left:${left}%;width:${Math.max(w, .4)}%"></b>${med != null ? `<span class="med" style="left:${(med - lo) / span * 100}%"></span>` : ''}</span><span class="v">${esc(fmt(v, m))}</span></a>`;
  }
  function tegnKort() {
    const m = D.maal[state.kortMaal]; m.key = state.kortMaal;
    const aarListe = m.aar.filter(a => vaerdier(m, a).length >= 80);
    const aar = state.kortAar && aarListe.includes(state.kortAar) ? state.kortAar : sidsteAar(m);
    $('#kaar').innerHTML = aarListe.slice().reverse().map(a => `<option ${a === aar ? 'selected' : ''}>${a}</option>`).join('');
    const kl = klasser(m, aar);
    const box = $('#kort');
    box.innerHTML = kortSVG(k => kl.klasse(val(m, k, aar)), { zoom: state.zoom, sel: state.kode, fokus: true, label: `${m.navn} ${aar} pr. kommune` }) +
      `<button class="zoom" id="zoom" aria-pressed="${state.zoom}">${state.zoom ? 'Hele landet' : 'Zoom ind på hovedstaden'}</button>`;
    bindKort(box, m, aar, k => { location.hash = 'kommune-' + k; });
    $('#zoom').addEventListener('click', () => { state.zoom = !state.zoom; tegnKort(); });
    $('#klegend').innerHTML = kl.legend.map(([c, t]) => `<span><i class="${c}" style="background:var(--${c.replace(/^c/, 'q')})"></i>${esc(t)}</span>`).join('') + `<span><i class="na"></i>Ingen tal</span>`;
    const vs = vaerdier(m, aar).sort((a, b) => b[1] - a[1]);
    const lo = Math.min(0, ...vs.map(x => x[1])), hi = Math.max(0, ...vs.map(x => x[1])), med = median(vs.map(x => x[1]));
    $('#toptitel').textContent = `${m.navn}: højeste, ${aar}`;
    $('#topsub').textContent = `${m.beskrivelse || ''} Medianen (stregen) er ${fmt(med, m).replace(/\.$/, '')}.`.trim();
    $('#top').innerHTML = vs.slice(0, 10).map((x, i) => rowHTML(m, x[0], x[1], i + 1, lo, hi, med, x[0] === state.kode)).join('');
    $('#bund').innerHTML = vs.slice(-5).map((x, i) => rowHTML(m, x[0], x[1], vs.length - 4 + i, lo, hi, med, x[0] === state.kode)).join('');
  }
  function tegnAlle() {
    const cols = NOEGLE.filter(k => D.maal[k]);
    const data = KODER.map(k => ({ k, navn: K[k].navn, region: regionKort(K[k].region), ...Object.fromEntries(cols.map(c => [c, seneste(D.maal[c], k)[1]])) }));
    const { col, dir } = state.sort;
    data.sort((a, b) => {
      const x = a[col], y = b[col];
      if (typeof x === 'string' || typeof y === 'string') return dir * String(x).localeCompare(String(y), 'da');
      return dir * ((x ?? -Infinity) - (y ?? -Infinity));
    });
    const th = (c, t, num) => `<th class="${num ? 'num' : ''}" aria-sort="${col === c ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"><button data-c="${c}">${esc(t)}${col === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`;
    $('#alle').innerHTML = `<thead><tr>${th('navn', 'Kommune')}${th('region', 'Region')}${cols.map(c => th(c, D.maal[c].navn, true)).join('')}</tr></thead><tbody>${data.map(r => `<tr><td><a href="#kommune-${r.k}">${esc(r.navn)}</a></td><td>${esc(r.region)}</td>${cols.map(c => `<td class="num">${esc(fmt(r[c], D.maal[c], false))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    $('#alle').querySelectorAll('th button').forEach(b => b.addEventListener('click', () => {
      const c = b.dataset.c; state.sort = { col: c, dir: state.sort.col === c ? -state.sort.dir : (c === 'navn' || c === 'region' ? 1 : -1) }; tegnAlle();
    }));
  }

  function kommune(kode) {
    if (!K[kode]) kode = state.kode in K ? state.kode : KODER[0];
    state.kode = kode; store.set('kode', kode); $('#vaelg').value = kode;
    setView('kommune');
    const k = K[kode], mb = D.maal.bef;
    const [ba, bv] = seneste(mb, kode); const r = rang(mb, kode, ba);
    const mv = D.maal.vaekst; const vv = mv ? seneste(mv, kode)[1] : null;
    const sub = `${esc(k.region)} · ${nf(0).format(bv)} indbyggere 1. januar ${ba}${vv != null ? `, ${vv >= 0 ? '+' : '−'}${nf(2).format(Math.abs(vv))} pct. på et år` : ''} · nr. ${r[0]} af ${r[1]} efter størrelse.`;
    const iHoved = k.region === 'Region Hovedstaden' && kode !== '400';
    const fd = fordeling(kode), fl = fordeling('000');
    const kat = KATEGORIER.map(c => {
      const ks = maalListe().filter(x => D.maal[x].kategori === c && D.maal[x].aar.length > 1 && !UDENKURVE.has(x));
      if (!ks.length) return '';
      const kort = ks.map(x => {
        const m = D.maal[x]; m.key = x;
        const serier = [{ navn: k.navn, farve: SERIE[0], vals: m.v[kode] || m.aar.map(() => null) }];
        if (!SUM.has(x)) { const rf = ref(m); serier.push({ navn: rf.navn, farve: 'var(--ref)', vals: rf.vals }); }
        const [a, v] = seneste(m, kode); const rv = a ? refVal(m, a) : null;
        const s = a ? `${esc(k.navn)}: <b>${esc(fmt(v, m))}</b> i ${a}${!SUM.has(x) && rv != null ? ` · ${esc(serier[1].navn.toLowerCase())}: ${esc(fmt(rv, m))}` : ''}` : 'Ingen tal for kommunen.';
        return chartCard('f-' + x, m, m.navn, s, serier);
      }).join('');
      const seg = c === 'Økonomi' && fd ? `<div class="chart" style="grid-column:1/-1"><h3>Hvad går driftsudgifterne til? ${esc(fd.aar)}</h3><p class="sub">Nettodriftsudgifter pr. indbygger fordelt på hovedområder, ${esc(k.navn)} og hele landet.</p>${segHTML(k.navn, fd)}${fl ? segHTML('Hele landet', fl) : ''}<div class="legend">${fd.navne.map((n, i) => `<span><i style="background:${SERIE[i]}"></i>${esc(n)}</span>`).join('')}</div><details class="tbl"><summary>Vis tallene</summary><div class="scroll"><table><thead><tr><th>Område</th><th class="num">${esc(k.navn)}</th><th class="num">Hele landet</th></tr></thead><tbody>${fd.navne.map((n, i) => `<tr><td>${esc(n)}</td><td class="num">${esc(nf(0).format(fd.vals[i]))} kr.</td><td class="num">${fl ? esc(nf(0).format(fl.vals[i])) + ' kr.' : '–'}</td></tr>`).join('')}</tbody></table></div></details></div>` : (c === 'Erhverv' ? erhvervHTML(kode) : '');
      return `<section class="band"><div class="wrap"><h2 style="font-size:28px">${c}</h2><div class="grid2">${kort}${seg}</div></div></section>`;
    }).join('');
    main.innerHTML = `
      <section class="band"><div class="wrap split prof">
        <div><h2>${esc(k.navn)} Kommune</h2><p class="muted">${sub}</p>
          <div class="tiles">${NOEGLE.filter(x => D.maal[x] && x !== 'bef').map(x => { D.maal[x].key = x; return tile(D.maal[x], kode, true); }).join('')}${D.maal.areal ? tile(D.maal.areal, kode, true) : ''}</div>
          <p class="small muted">Rang: nr. 1 er den kommune med den højeste værdi. Pilene viser ændringen siden året før.</p></div>
        <div><div class="mapbox" id="lokal"></div><p class="small muted">${iHoved ? 'Udsnit: hovedstadsområdet.' : 'Bornholm er vist i boksen øverst til højre.'} Klik på en anden kommune for at skifte.</p></div>
      </div></section>
      <section class="band"><div class="wrap"><h2 style="font-size:28px">Budgetaftale 2027</h2>${budgetHTML(kode)}</div></section>
      ${kat}`;
    const lb = $('#lokal');
    lb.innerHTML = kortSVG(x => 'loc' + (x === kode ? ' me' : ''), { zoom: iHoved, label: `${k.navn} på kortet` });
    bindKort(lb, null, null, x => { location.hash = 'kommune-' + x; });
    KATEGORIER.forEach(c => maalListe().filter(x => D.maal[x].kategori === c && D.maal[x].aar.length > 1 && !UDENKURVE.has(x)).forEach(x => {
      const m = D.maal[x]; const fig = $('#f-' + x); if (!fig) return;
      const serier = [{ navn: k.navn, farve: SERIE[0], vals: m.v[kode] || m.aar.map(() => null) }];
      if (!SUM.has(x)) { const rf = ref(m); serier.push({ navn: rf.navn, farve: 'var(--ref)', vals: rf.vals }); }
      linje(fig, { aar: m.aar, serier, m, label: `${m.navn}, ${k.navn}` });
    }));
    scrollTo(0, 0);
  }

  function sammenlign() {
    setView('sammenlign');
    if (!state.sml) state.sml = [state.kode, '751', '851', '101'].filter((x, i, a) => K[x] && a.indexOf(x) === i).slice(0, 3);
    const opt = sel => `<option value="">– ingen –</option>` + KODER.slice().sort((a, b) => K[a].navn.localeCompare(K[b].navn, 'da')).map(x => `<option value="${x}" ${x === sel ? 'selected' : ''}>${esc(K[x].navn)}</option>`).join('');
    // farven følger pladsen (kommune 1, 2, 3), så en tom plads ikke omfarver de andre
    const plads = state.sml.map((x, i) => [x, i]).filter(([x]) => K[x]);
    const valgt = plads.map(([x]) => x);
    const serierFor = m => plads.map(([x, i]) => ({ navn: K[x].navn, farve: SERIE[i], vals: m.v[x] || m.aar.map(() => null) }));
    const tabel = `<div class="scroll"><table><thead><tr><th>Mål (seneste år)</th>${valgt.map(x => `<th class="num">${esc(K[x].navn)}</th>`).join('')}<th class="num">Land/median</th></tr></thead><tbody>${maalListe().map(x => {
      const m = D.maal[x]; m.key = x; const a = sidsteAar(m);
      return `<tr><td>${esc(m.navn)} <span class="muted small">${a}</span></td>${valgt.map(k => `<td class="num">${esc(fmt(val(m, k, a), m))}</td>`).join('')}<td class="num">${SUM.has(x) ? '–' : esc(fmt(refVal(m, a), m))}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    main.innerHTML = `
      <section class="band"><div class="wrap">
        <h2>Sammenlign op til tre kommuner</h2>
        <p class="muted">Hele landet, eller mediankommunen hvor der ikke er et landstal, vises med gråt. Kurverne viser alle år, vi har tal for.</p>
        <div class="filters">${[0, 1, 2].map(i => `<label for="sml${i}"><span><i style="display:inline-block;width:18px;height:3px;border-radius:2px;vertical-align:4px;margin-right:6px;background:${SERIE[i]}"></i>Kommune ${i + 1}</span><select id="sml${i}">${opt(state.sml[i])}</select></label>`).join('')}</div>
        ${tabel}
      </div></section>
      ${KATEGORIER.map(c => {
        const ks = maalListe().filter(x => D.maal[x].kategori === c && D.maal[x].aar.length > 1 && !UDENKURVE.has(x)); if (!ks.length) return '';
        return `<section class="band"><div class="wrap"><h2 style="font-size:28px">${c}</h2><div class="grid2">${ks.map(x => {
          const m = D.maal[x]; const s = serierFor(m); if (!SUM.has(x)) { const rf = ref(m); s.push({ navn: rf.navn, farve: 'var(--ref)', vals: rf.vals }); }
          return chartCard('s-' + x, m, m.navn, esc(m.beskrivelse || m.kilde), s);
        }).join('')}</div></div></section>`;
      }).join('')}`;
    [0, 1, 2].forEach(i => $('#sml' + i).addEventListener('change', e => { state.sml[i] = e.target.value; state.sml = state.sml.slice(0, 3); store.set('sml', state.sml); sammenlign(); }));
    maalListe().forEach(x => {
      const fig = $('#s-' + x); if (!fig) return; const m = D.maal[x]; m.key = x;
      const s = serierFor(m); if (!SUM.has(x)) { const rf = ref(m); s.push({ navn: rf.navn, farve: 'var(--ref)', vals: rf.vals }); }
      linje(fig, { aar: m.aar, serier: s, m });
    });
  }

  function rangliste() {
    setView('rangliste');
    const liste = maalListe();
    if (!D.maal[state.rangMaal]) state.rangMaal = liste[0];
    const m = D.maal[state.rangMaal]; m.key = state.rangMaal;
    const aarListe = m.aar.filter(a => vaerdier(m, a).length >= 80);
    const aar = state.rangAar && aarListe.includes(state.rangAar) ? state.rangAar : sidsteAar(m);
    const vs = vaerdier(m, aar).sort((a, b) => b[1] - a[1]);
    const lo = Math.min(0, ...vs.map(x => x[1])), hi = Math.max(0, ...vs.map(x => x[1])), med = median(vs.map(x => x[1]));
    const top = vs[0], bund = vs[vs.length - 1];
    const forhold = top[1] > 0 && bund[1] > 0 && !pctEnhed(m) ? ` – ${nf(1).format(top[1] / bund[1])} gange så meget som ${esc(K[bund[0]].navn)}` : `, ${esc(K[bund[0]].navn)} lavest med ${esc(fmt(bund[1], m))}`;
    const egen = rang(m, state.kode, aar);
    main.innerHTML = `<section class="band"><div class="wrap">
      <h2>${esc(K[top[0]].navn)} ligger øverst på ${esc(m.navn.toLowerCase())} med ${esc(fmt(top[1], m))}${forhold}</h2>
      <div class="filters">
        <label for="rmaal">Mål<select id="rmaal">${KATEGORIER.map(c => `<optgroup label="${c}">${liste.filter(k => D.maal[k].kategori === c).map(k => `<option value="${k}" ${k === state.rangMaal ? 'selected' : ''}>${esc(D.maal[k].navn)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <label for="raar">År<select id="raar">${aarListe.slice().reverse().map(a => `<option ${a === aar ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      </div>
      <p class="muted small">${esc(m.beskrivelse || '')} Kilde: ${esc(m.kilde)}. Medianen er ${esc(fmt(med, m))} (den mørke streg).${egen ? ` ${esc(K[state.kode].navn)} er nr. ${egen[0]} af ${egen[1]} og er fremhævet.` : ''}</p>
      <div class="rows">${vs.map((x, i) => rowHTML(m, x[0], x[1], i + 1, lo, hi, med, x[0] === state.kode)).join('')}</div>
    </div></section>`;
    $('#rmaal').addEventListener('change', e => { state.rangMaal = e.target.value; state.rangAar = null; store.set('rangMaal', state.rangMaal); rangliste(); });
    $('#raar').addEventListener('change', e => { state.rangAar = +e.target.value; rangliste(); });
  }

  function budget() {
    setView('budget');
    const alle = KODER.filter(k => D.budget2027[k]).map(k => ({ k, b: D.budget2027[k], t: skatType(D.budget2027[k]) }));
    const n = t => alle.filter(x => x.t === t).length;
    const klima = alle.filter(x => x.b.klima && !/^ikke nævnt/i.test(x.b.klima)).length;
    main.innerHTML = `<section class="band"><div class="wrap">
      <h2>${n('hæves')} kommuner hæver skatten i 2027, ${n('uændret')} holder den i ro</h2>
      <p class="muted">Vi har analyseret budgetaftalerne for ${alle.length} af 98 kommuner. ${n('ikke nævnt')} aftaler nævner ikke skatten, og ${klima} omtaler klima. Analyserne bygger på aftaleteksterne, og hvor de manglede, på kommunens egen nyhed; kvaliteten står på hvert kort.</p>
      <div class="filters">
        <label for="bq">Søg<input type="search" id="bq" placeholder="Kommune, parti eller emne" value="${esc(state.budgetQ)}"></label>
        <div class="chips" role="group" aria-label="Filter">${[['alle', 'Alle'], ['hæves', 'Skatten hæves'], ['uændret', 'Skatten uændret'], ['klima', 'Nævner klima']].map(([v, t]) => `<button data-f="${v}" aria-pressed="${state.budgetF === v}">${t}</button>`).join('')}</div>
      </div>
      <div class="cards" id="bcards"></div></div></section>`;
    const tegn = () => {
      const q = state.budgetQ.trim().toLowerCase();
      const vis = alle.filter(x => (state.budgetF === 'alle' || x.t === state.budgetF || (state.budgetF === 'klima' && x.b.klima && !/^ikke nævnt/i.test(x.b.klima))) &&
        (!q || (K[x.k].navn + ' ' + JSON.stringify(x.b)).toLowerCase().includes(q))).sort((a, b) => K[a.k].navn.localeCompare(K[b.k].navn, 'da'));
      $('#bcards').innerHTML = vis.length ? vis.map(({ k, b, t }) => `<div class="card"><h3><a href="#kommune-${k}">${esc(K[k].navn)}</a></h3>
        <p><span class="tag red">Skat: ${esc(t)}</span>${(b.partier || []).slice(0, 4).map(p => `<span class="tag">${esc(p)}</span>`).join('')}</p>
        <p class="small">${esc(b.resume)}</p><h4 class="small" style="margin:6px 0 0">Prioriteter</h4>${listeHTML(b.prioriteter, 3)}
        <h4 class="small" style="margin:6px 0 0">Besparelser</h4>${listeHTML(b.besparelser, 2)}<p class="small muted">${esc(b.kvalitet || '')}</p></div>`).join('')
        : '<p class="empty">Ingen aftaler matcher søgningen.</p>';
    };
    $('#bq').addEventListener('input', e => { state.budgetQ = e.target.value; tegn(); });
    document.querySelectorAll('.chips button').forEach(b => b.addEventListener('click', () => {
      state.budgetF = b.dataset.f; document.querySelectorAll('.chips button').forEach(x => x.setAttribute('aria-pressed', x === b)); tegn();
    }));
    tegn();
  }

  function om() {
    setView('om');
    main.innerHTML = `<section class="band"><div class="wrap">
      <h2>Om data: ${Object.keys(D.maal).length} mål for 98 kommuner, opdateret ${esc(D.genereret)}</h2>
      <p>Tallene hentes automatisk fra Danmarks Statistiks Statistikbank hver mandag via et GitHub-job og samles til denne side med scriptet <code>scripts/byg_site_data.py</code>. Budgetaftalerne for 2027 er indsamlet fra kommunernes hjemmesider og uploads og analyseret tekst for tekst.</p>
      <p class="muted small">Beløb er i løbende priser. Pr. indbygger-tal bruger befolkningen 1. januar samme år. Landstal er summen for hele landet; hvor DST ikke giver et landstal, sammenlignes med mediankommunen.</p>
      <div class="scroll"><table><thead><tr><th>Mål</th><th>Emne</th><th>År</th><th>Kilde</th><th>Definition</th></tr></thead><tbody>
      ${maalListe().map(x => { const m = D.maal[x]; return `<tr><td>${esc(m.navn)}</td><td>${esc(m.kategori)}</td><td class="num">${m.aar[0]}–${m.aar[m.aar.length - 1]}</td><td>${esc(m.kilde)}</td><td class="small">${esc(m.beskrivelse || '')}</td></tr>`; }).join('')}
      </tbody></table></div>
      <h3 style="margin-top:24px">Hvad er nyt</h3>
      <ul><li>Budgetaftaler 2027 for ${Object.keys(D.budget2027).length} kommuner med prioriteter, besparelser, finansiering og skat.</li><li>Kort over alle kommuner med valgfrit mål og zoom på hovedstaden.</li><li>Erhverv: hvor borgerne arbejder, fordelt på 10 brancher.</li><li>Kommunale nøgletal: udgifter pr. ældre, pr. elev, pr. 0-10-årig, gæld og service.</li><li>Sammenligning af op til tre kommuner og ranglister for alle mål.</li></ul>
    </div></section>`;
  }

  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    const mm = h.match(/^kommune-(\d{3})$/);
    if (mm) return kommune(mm[1]);
    if (h === 'kommune') return kommune(state.kode);
    if (h === 'sammenlign') return sammenlign();
    if (h === 'rangliste') return rangliste();
    if (h === 'budget') return budget();
    if (h === 'om') return om();
    return overblik();
  }

  async function start() {
    try {
      const [d, k] = await Promise.all([fetch('data/data.json').then(r => r.json()), fetch('data/kort.json').then(r => r.json())]);
      D = d; KORT = k;
    } catch (e) {
      main.innerHTML = '<div class="wrap band empty">Data kunne ikke indlæses. Prøv at genindlæse siden.</div>'; return;
    }
    KODER = D.kommuner.map(x => x.kode);
    D.kommuner.forEach(x => { K[x.kode] = x; });
    Object.entries(D.maal).forEach(([key, m]) => { m.key = key; });
    if (!K[state.kode]) state.kode = '101';
    hovedBox = bbox(KODER.filter(x => K[x].region === 'Region Hovedstaden' && x !== '400'));
    const sel = $('#vaelg');
    sel.innerHTML = KODER.slice().sort((a, b) => K[a].navn.localeCompare(K[b].navn, 'da')).map(x => `<option value="${x}">${esc(K[x].navn)}</option>`).join('');
    sel.value = state.kode;
    sel.addEventListener('change', e => {
      state.kode = e.target.value; store.set('kode', state.kode);
      if (state.view === 'rangliste') rangliste();
      else if (state.view === 'sammenlign') { state.sml[0] = state.kode; store.set('sml', state.sml); sammenlign(); }
      else location.hash = 'kommune-' + state.kode;
    });
    const antalB = Object.keys(D.budget2027).length;
    $('#snap').textContent = `Datasnapshot ${new Date(D.genereret).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })} · Danmarks Statistik og ${antalB} budgetaftaler for 2027 · uofficiel sammenstilling`;
    window.addEventListener('hashchange', route);
    route();
  }
  start();
}
