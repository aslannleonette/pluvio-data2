// Uso: Playwright para renderizar a página e capturar links .csv/.txt
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright"); // instalado pelo workflow

const BASE = "https://meteorologia.emparn.rn.gov.br";
const URL  = `${BASE}/boletim/diario`;
const UA   = "PluvioRN-Bot/1.0 (+github actions)";

async function downloadToFile(url, outFile, referer) {
  const headers = { "User-Agent": UA };
  if (referer) headers["Referer"] = referer;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  const text = await res.text();
  fs.writeFileSync(outFile, text, "utf8");
}

(async () => {
  fs.mkdirSync("data", { recursive: true });

  console.log(">> Abrindo Chromium headless…");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ userAgent: UA, javaScriptEnabled: true });
  const page = await ctx.newPage();

  console.log(">> Acessando:", URL);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });

  // Salva HTML renderizado para debug
  const html = await page.content();
  fs.writeFileSync(path.join("data", "rendered.html"), html, "utf8");

  // Coleta todos os links clicáveis (href absolutizado pelo próprio browser)
  const links = await page.$$eval("a", as => as.map(a => a.href || "").filter(Boolean));
  fs.writeFileSync(path.join("data", "links.txt"), links.join("\n"), "utf8");

  // Filtros: prioriza CSV; fallback TXT
  const csvLinks = links.filter(h => /\.csv(\?|#|$)/i.test(h));
  const txtLinks = links.filter(h => /\.txt(\?|#|$)/i.test(h));

  console.log("CSV links:", csvLinks.length, csvLinks.slice(0, 3));
  console.log("TXT links:", txtLinks.length, txtLinks.slice(0, 3));

  // baixa o primeiro CSV ou TXT
  if (csvLinks.length) {
    const u = csvLinks[0];
    console.log(">> Baixando CSV:", u);
    await downloadToFile(u, path.join("data","latest.csv"), URL);
    console.log("OK: data/latest.csv");
  } else if (txtLinks.length) {
    const u = txtLinks[0];
    console.log(">> Baixando TXT:", u);
    await downloadToFile(u, path.join("data","latest.txt"), URL);
    console.log("OK: data/latest.txt");
  } else {
    console.error("ERRO: não encontrei links .csv nem .txt na página renderizada.");
    process.exitCode = 1;
  }

  await browser.close();
})().catch(err => {
  console.error("FALHA:", err?.stack || err?.message || String(err));
  process.exit(1);
});