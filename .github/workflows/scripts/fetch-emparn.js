// scripts/fetch-emparn-playwright.cjs
// Lê o boletim diário da EMPARN, percorre as abas e extrai a tabela renderizada.
// Salva data/latest.csv e data/latest.json
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const Papa = require("papaparse");

const URL  = "https://meteorologia.emparn.rn.gov.br/boletim/diario";
const UA   = "PluvioRN-Bot/1.0 (+github actions)";

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function saveText(file, text) { fs.writeFileSync(file, text, "utf8"); }

function norm(s) {
  return String(s || "")
    .replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/[áàâã]/g,"a").replace(/[éê]/g,"e").replace(/[í]/g,"i")
    .replace(/[óôõ]/g,"o").replace(/[ú]/g,"u").replace(/ç/g,"c");
}

async function extractTableFromContainer(page, containerSelector, regiao) {
  // espera a tabela aparecer na aba
  await page.waitForSelector(`${containerSelector} table`, { timeout: 30000 });

  // captura cabeçalhos
  const headers = await page.$$eval(
    `${containerSelector} table thead th, ${containerSelector} table tr th`,
    ths => ths.map(th => th.textContent?.trim() ?? "")
  );

  // índice por nome normalizado
  const hmap = {};
  headers.forEach((h, i) => (hmap[norm(h)] = i));

  // captura linhas
  const rows = await page.$$eval(
    `${containerSelector} table tbody tr`,
    trs => trs.map(tr =>
      Array.from(tr.querySelectorAll("td")).map(td =>
        (td.textContent || "").replace(/\s+/g, " ").trim()
      )
    )
  );

  // resolve índices pelos textos esperados
  const idx = (alts) => {
    for (const a of alts) {
      const k = norm(a);
      if (k in hmap) return hmap[k];
    }
    return -1;
  };

  const iMunicipio = idx(["municipio"]);
  const iPosto = idx(["posto"]);
  const iTipo = idx(["tipo de posto","tipo"]);
  const iHoras = idx(["horas contabilizadas","horas"]);
  const iPrec  = idx(["precipitacao (mm)","precipitacao","chuva (mm)","chuva"]);

  const parseNum = v => {
    if (v == null || v === "") return null;
    const x = String(v).replace(/\./g,"").replace(",","."); // lida com "1.234,56"
    const n = parseFloat(x);
    return Number.isFinite(n) ? n : null;
    };

  const out = rows.map(cells => ({
    regiao,
    municipio: iMunicipio>=0 ? cells[iMunicipio] : null,
    posto:     iPosto>=0     ? cells[iPosto]     : null,
    tipo_posto:iTipo>=0      ? cells[iTipo]      : null,
    horas:     iHoras>=0     ? cells[iHoras]     : null,
    precipitacao_mm: parseNum(iPrec>=0 ? cells[iPrec] : null),
  }));

  // remove linhas totalmente vazias
  return out.filter(r => r.municipio || r.posto || r.precipitacao_mm!=null);
}

async function maybeDownloadByButtons(page) {
  // Caso passem a expor links CSV/TXT, tentamos baixar
  const links = await page.$$eval("a,button", els =>
    els.map(el => ({
      tag: el.tagName,
      text: (el.textContent || "").trim(),
      href: el.getAttribute("href") || "",
      onclick: el.getAttribute("onclick") || "",
    }))
  );

  const findUrl = (rx) => {
    const a = links.find(l => rx.test(l.href));
    if (a && a.href) return a.href;
    // às vezes é botão sem href mas com onclick que chama download
    const b = links.find(l => rx.test(l.onclick || ""));
    return b ? b.onclick.match(rx)?.[0] : null;
  };

  const csvUrl = findUrl(/\.csv(\?|#|$)/i);
  const txtUrl = findUrl(/\.txt(\?|#|$)/i);

  async function httpGet(u) {
    const res = await fetch(u, { headers: { "User-Agent": UA, Referer: URL } });
    if (!res.ok) return null;
    return await res.text();
  }

  if (csvUrl) {
    const t = await httpGet(csvUrl);
    if (t && t.length > 0) { saveText("data/latest.csv", t); return "csv"; }
  }
  if (txtUrl) {
    const t = await httpGet(txtUrl);
    if (t && t.length > 0) { saveText("data/latest.txt", t); return "txt"; }
  }
  return null;
}

(async () => {
  ensureDir("data");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();

  console.log(">> Acessando:", URL);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });

  // 0) tentar CSV/TXT caso exista export
  const viaExport = await maybeDownloadByButtons(page);
  if (viaExport) {
    console.log(`OK via export: ${viaExport} -> data/latest.${viaExport}`);
  }

  // 1) raspagem de todas as abas
  const abas = [
    { id: "agreste_potiguar", label: "Agreste Potiguar" },
    { id: "central_potiguar", label: "Central Potiguar" },
    { id: "leste_potiguar",   label: "Leste Potiguar"   },
    { id: "oeste_potiguar",   label: "Oeste Potiguar"   },
  ];

  const allRows = [];
  for (const a of abas) {
    const linkSel = `a#${a.id}`;
    const contentSel = `#${a.id}-content`;

    // alguns sites já deixam a primeira aba ativa; clique mesmo assim
    if (await page.$(linkSel)) {
      await page.click(linkSel);
    }
    // espera a tabela da aba
    try {
      const rows = await extractTableFromContainer(page, contentSel, a.label);
      console.log(`.. ${a.label}: ${rows.length} linhas`);
      allRows.push(...rows);
    } catch (e) {
      console.warn(`!! Falha ao ler ${a.label}:`, e.message);
    }
  }

  if (!allRows.length && !viaExport) {
    // salva o HTML para debug se nada veio
    saveText("data/rendered.html", await page.content());
    throw new Error("Nenhuma linha de tabela encontrada nas abas e sem export CSV/TXT.");
  }

  // 2) normaliza e salva CSV/JSON unificado (preferido pelo PluvioRN)
  if (allRows.length) {
    saveText("data/latest.json", JSON.stringify(allRows, null, 2));
    const csv = Papa.unparse(allRows, { newline: "\n" });
    saveText("data/latest.csv", csv);
    console.log(`OK por DOM: ${allRows.length} linhas -> data/latest.csv & data/latest.json`);
  }

  await browser.close();
})().catch(err => {
  console.error("FALHA:", err?.stack || err?.message || String(err));
  process.exit(1);
});
