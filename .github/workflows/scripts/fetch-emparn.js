// Lê https://meteorologia.emparn.rn.gov.br/boletim/diario
// 1) Tenta CSV (fallback TXT) por links na página
// 2) Se não achar, raspa TODAS as tabelas renderizadas (DOM) e gera latest.csv + latest.json
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Papa = require("papaparse");

const BASE = "https://meteorologia.emparn.rn.gov.br";
const URL  = `${BASE}/boletim/diario`;
const UA   = "PluvioRN-Bot/1.0 (+github actions)";

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function saveText(file, text) { fs.writeFileSync(file, text, "utf8"); }
async function httpGet(url, referer) {
  const headers = { "User-Agent": UA };
  if (referer) headers["Referer"] = referer;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${url}`);
  return r.text();
}

async function byLinks(page) {
  const links = await page.$$eval("a", as => as.map(a => a.href || "").filter(Boolean));
  const csv = links.find(h => /\.csv(\?|#|$)/i.test(h));
  const txt = links.find(h => /\.txt(\?|#|$)/i.test(h));
  if (csv) {
    const t = await httpGet(csv, URL);
    saveText("data/latest.csv", t);
    return { kind: "csv", url: csv };
  }
  if (txt) {
    const t = await httpGet(txt, URL);
    saveText("data/latest.txt", t);
    return { kind: "txt", url: txt };
  }
  return null;
}

function normalizeHeader(h) {
  const s = (h || "").toString().trim().toLowerCase();
  return s
    .replace(/\s+/g, " ")
    .replace(/[áàâã]/g,"a").replace(/[éê]/g,"e").replace(/[í]/g,"i")
    .replace(/[óôõ]/g,"o").replace(/[ú]/g,"u").replace(/ç/g,"c");
}

function parseTablesToRows(htmlRendered) {
  // Parse de tabelas sem libs: heurística via regex simples (thead/th/td)
  // Obs.: é um fallback robusto — cobre a maioria dos boletins usuais.
  const tables = [...htmlRendered.matchAll(/<table[\s\S]*?<\/table>/gi)].map(m => m[0]);
  const rowsOut = [];
  for (const tb of tables) {
    // headers
    const headTr = tb.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || tb.match(/<tr[\s\S]*?<\/tr>/i)?.[0] || "";
    const ths = [...headTr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(m => m[1]
      .replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").trim());
    const headers = ths.length ? ths.map(normalizeHeader) : [];

    // body rows
    const body = tb.replace(/[\s\S]*?<tbody[^>]*>/i,"").replace(/<\/tbody>[\s\S]*$/i,"") || tb;
    const trs = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => m[1]);
    for (const tr of trs) {
      const tds = [...tr.matchAll