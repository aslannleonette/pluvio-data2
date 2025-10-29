// scripts/fetch-emparn-playwright.js
// Lê o boletim diário da EMPARN. Tenta CSV/TXT; se não houver, raspa as abas e gera latest.csv/json.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Papa = require("papaparse");

const URL  = "https://meteorologia.emparn.rn.gov.br/boletim/diario";
const UA   = "PluvioRN-Bot/1.0 (+github actions)";

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function saveText(file, text) { fs.writeFileSync(file, text, "utf8"); }
const norm = s => String(s||"").replace(/\s+/g," ").trim().toLowerCase()
  .replace(/[áàâã]/g,"a").replace(/[éê]/g,"e").replace(/[í]/g,"i")
  .replace(/[óôõ]/g,"o").replace(/[ú]/g,"u").replace(/ç/g,"c");

async function maybeDownloadByButtons(page) {
  const els = await page.$$eval("a,button", es =>
    es.map(el => ({
      text: (el.textContent||"").trim(),
      href: el.getAttribute("href")||"",
      onclick: el.getAttribute("onclick")||""
    }))
  );
  const findUrl = rx => {
    const a = els.find(e => rx.test(e.href));
    if (a && a.href) return a.href;
    const b = els.find(e => rx.test(e.onclick));
    return b ? (b.onclick.match(rx)||[])[0] : null;
  };
  const csvUrl = findUrl(/\.csv(\?|#|$)/i);
  const txtUrl = findUrl(/\.txt(\?|#|$)/i);

  async function httpGet(u) {
    const r = await fetch(u, { headers: { "User-Agent": UA, Referer: URL }});
    if (!r.ok) return null;
    return r.text();
  }

  if (csvUrl) { const t = await httpGet(csvUrl); if (t) { saveText("data/latest.csv", t); return "csv"; } }
  if (txtUrl) { const t = await httpGet(txtUrl); if (t) { saveText("data/latest.txt", t); return "txt"; } }
  return null;
}

async function extractTableFromContainer(page, containerSelector, regiao) {
  await page.waitForSelector(`${containerSelector} table`, { timeout: 30000 });

  const headers = await page.$$eval(
    `${containerSelector} table thead th, ${containerSelector} table tr th`,
    ths => ths.map(th => th.textContent?.trim() ?? "")
  );
  const hmap = {}; headers.forEach((h,i)=> hmap[norm(h)] = i);

  const rows = await page.$$eval(
    `${containerSelector} table tbody tr`,
    trs => trs.map(tr => Array.from(tr.querySelectorAll("td"))
      .map(td => (td.textContent || "").replace(/\s+/g," ").trim()))
  );

  const idx = alts => { for (const a of alts){ const k=norm(a); if (k in hmap) return hmap[k]; } return -1; };

  const iMunicipio = idx(["municipio"]);
  const iPosto     = idx(["posto"]);
  const iTipo      = idx(["tipo de posto","tipo"]);
  const iHoras     = idx(["horas contabilizadas","horas"]);
  const iPrec      = idx(["precipitacao (mm)","precipitacao","chuva (mm)","chuva"]);

  const parseNum = v => {
    if (v==null || v==="") return null;
    const n = parseFloat(String(v).replace(/\./g,"").replace(",","."));
    return Number.isFinite(n) ? n : null;
  };

  return rows.map(cells => ({
    regiao,
    municipio: iMunicipio>=0 ? cells[iMunicipio] : null,
    posto:     iPosto>=0     ? cells[iPosto]     : null,
    tipo_posto:iTipo>=0      ? cells[iTipo]      : null,
    horas:     iHoras>=0     ? cells[iHoras]     : null,
    precipitacao_mm: parseNum(iPrec>=0 ? cells[iPrec] : null),
  })).filter(r => r.municipio || r.posto || r.precipitacao_mm!=null);
}

(async () => {
  ensureDir("data");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  console.log(">> Acessando:", URL);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });

  // 1) tenta export oficial (CSV/TXT)
  const viaExport = await maybeDownloadByButtons(page);
  if (viaExport) console.log(`OK via export: ${viaExport}`);

  // 2) raspagem por abas
  const abas = [
    { id: "agreste_potiguar", label: "Agreste Potiguar" },
    { id: "central_potiguar", label: "Central Potiguar" },
    { id: "leste_potiguar",   label: "Leste Potiguar"   },
    { id: "oeste_potiguar",   label: "Oeste Potiguar"   },
  ];

  const all = [];
  for (const a of abas) {
    const linkSel = `a#${a.id}`;
    const contentSel = `#${a.id}-content`;
    if (await page.$(linkSel)) await page.click(linkSel);
    try {
      const rows = await extractTableFromContainer(page, contentSel, a.label);
      console.log(`.. ${a.label}: ${rows.length} linhas`);
      all.push(...rows);
    } catch (e) {
      console.warn(`!! Falha ao ler ${a.label}:`, e.message);
    }
  }

  // 3) salvar
  if (all.length) {
    saveText("data/latest.json", JSON.stringify(all, null, 2));
    const csv = Papa.unparse(all, { newline: "\n" });
    saveText("data/latest.csv", csv);
    console.log(`OK por DOM: ${all.length} linhas -> data/latest.csv & data/latest.json`);
  } else if (!viaExport) {
    // salva DOM para debug
    saveText("data/rendered.html", await page.content());
    throw new Error("Nenhuma linha encontrada e sem export.");
  }

  await browser.close();
})().catch(err => {
  console.error("FALHA:", err?.stack || err?.message || String(err));
  process.exit(1);
});
