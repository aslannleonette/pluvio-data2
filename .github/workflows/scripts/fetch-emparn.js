// Busca o boletim diário da EMPARN e salva CSV (fallback TXT) em /data
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "fs";

const BASE = "https://meteorologia.emparn.rn.gov.br";
const URL  = `${BASE}/boletim/diario`;

async function getHtml(u) {
  const r = await fetch(u, { headers: { "User-Agent": "PluvioRN-Bot/1.0" }});
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${u}`);
  return r.text();
}

function abs(href) {
  if (!href) return null;
  return href.startsWith("http") ? href : BASE + href;
}

async function main() {
  const html = await getHtml(URL);
  const $ = cheerio.load(html);

  // tenta pegar links CSV e TXT na página
  const csvLink = $('a[href*=".csv"], a[href*=".CSV"]').first().attr("href");
  const txtLink = $('a[href*=".txt"], a[href*=".TXT"]').first().attr("href");

  let savedCsv = false, savedTxt = false;
  mkdirSync("data", { recursive: true });

  if (csvLink) {
    const u = abs(csvLink);
    try {
      const r = await fetch(u, { headers: { "User-Agent": "PluvioRN-Bot/1.0" }});
      if (r.ok) {
        const text = await r.text();
        writeFileSync("data/latest.csv", text, "utf8");
        savedCsv = true;
        console.log("OK: data/latest.csv");
      }
    } catch (e) {
      console.warn("Falha CSV:", e.message);
    }
  }

  if (!savedCsv && txtLink) {
    const u = abs(txtLink);
    const r = await fetch(u, { headers: { "User-Agent": "PluvioRN-Bot/1.0" }});
    if (!r.ok) throw new Error("TXT link indisponível");
    const text = await r.text();
    writeFileSync("data/latest.txt", text, "utf8");
    savedTxt = true;
    console.log("OK: data/latest.txt");
  }

  if (!savedCsv && !savedTxt) {
    throw new Error("Não encontrei CSV nem TXT do boletim.");
  }
}

main().catch(err => {
  console.error("ERRO:", err.message);
  process.exit(1);
});
