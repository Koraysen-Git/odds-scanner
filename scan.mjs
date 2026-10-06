// Avrupa oran tarayicisi — 30 dakikada bir GitHub Actions'tan kosar.
//
// Neden ayri ve PUBLIC repo: tarama gunde 48 kez kosuyor; private repoda bu
// ayda ~1.400 Actions dakikasi (Free kotasi 2.000) ederdi, public repoda
// dakika sinirsiz. Cloudflare Worker'dan kosamiyor: Worker'in paylasimli
// cikis IP'si API-Football'da dakikalik sinira takiliyor (olculdu 2026-10-05).
//
// Bu repo yalnizca VERI TASIR. Lig listesi ve bahisci sirasi uygulamadan
// okunur (/api/odds-track/config), acilis/seri mantigi uygulamadadir; burada
// yalnizca API yaniti inceltilir (kilit bahisciler + 1X2 ve 2.5 A/U).
//
// Gizli degerler Actions secret'larinda: API_FOOTBALL_KEY, ODDS_INGEST_KEY.
const BASE = process.env.APP_BASE || 'https://nova-drift.korayseninmaili.workers.dev';
const API = 'https://v3.football.api-sports.io';
const KEY = process.env.API_FOOTBALL_KEY;
const INGEST = process.env.ODDS_INGEST_KEY;
if (!KEY || !INGEST) throw new Error('API_FOOTBALL_KEY ve ODDS_INGEST_KEY gerekli');

// Gunluk kotada bu kadar istek kalmissa tur atlanir: bir tam tur ~50 istek,
// kota uygulamanin diger islerine de lazim.
const MIN_KALAN = 100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-odds-key': INGEST },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const st = await (await fetch(`${API}/status`, { headers: { 'x-apisports-key': KEY } })).json();
const rq = st?.response?.requests || {};
const kalan = (rq.limit_day || 0) - (rq.current || 0);
console.log(`plan ${st?.response?.subscription?.plan} · kalan ${kalan}/${rq.limit_day}`);
if (kalan < MIN_KALAN) { console.log(`::warning::gunluk kota az (${kalan}) — tur atlandi`); process.exit(0); }

const cfg = await (await fetch(BASE + '/api/odds-track/config')).json();
const books = new Set(cfg.books), bets = new Set(cfg.bets);
const errors = [];
let requests = 0, remaining = null;
const tot = { fixtures: 0, opened: 0, points: 0 };

dis: for (const lg of cfg.leagues) {
  let page = 1, total = 1;
  do {
    const r = await fetch(`${API}/odds?league=${lg.id}&season=${lg.season}&page=${page}`, { headers: { 'x-apisports-key': KEY } });
    requests++;
    const rem = Number(r.headers.get('x-ratelimit-requests-remaining'));
    if (Number.isFinite(rem)) remaining = rem;
    const j = await r.json().catch(() => null);
    const err = j?.errors && !Array.isArray(j.errors) && Object.keys(j.errors).length ? JSON.stringify(j.errors) : '';
    if (!j || err) {
      errors.push(`${lg.id}: ${err || 'HTTP ' + r.status}`);
      if (/limit|too many/i.test(err)) break dis;
      break;
    }
    total = j.paging?.total || 1;
    // Inceltme: ham oge mac basina ~110 KB, bu hali ~1.5 KB.
    const responses = (j.response || []).map((x) => ({
      fixture: { id: x.fixture?.id, date: x.fixture?.date },
      league: { id: x.league?.id },
      update: x.update,
      bookmakers: (x.bookmakers || []).filter((b) => books.has(b.id))
        .map((b) => ({ id: b.id, bets: (b.bets || []).filter((t) => bets.has(t.id)) })),
    }));
    if (responses.length) {
      const s = await post('/api/odds-track/ingest', { responses });
      tot.fixtures += s.fixtures; tot.opened += s.opened; tot.points += s.points;
    }
    page++;
    await sleep(250);
  } while (page <= total && page <= 6);
}

const ozet = { source: 'scanner', requests, ...tot, remaining, errors };
console.log(JSON.stringify(ozet));
await post('/api/odds-track/log', ozet);
if (errors.length) console.log(`::warning::${errors.length} hata: ${errors.slice(0, 3).join(' | ')}`);
