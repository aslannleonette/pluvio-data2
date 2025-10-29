// Busca o Boletim Diário da EMPARN, tenta CSV; se falhar, usa TXT.
// Salva em data/latest.csv (ou latest.txt) e também arquiva por data.
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { writeFileSync, mkdirSync } from "fs";

const BASE = "https://meteorologia.emparn.rn.gov.br";
const URL  = `${BASE}/boletim/diario`;

// Data (BRT/UTC-3) para nome de arquivo
function todayBRTISO() {
  const now = new Date();
  const utc = new Date(now.getTime() + now.getTimezoneOffset() * 60000);
  const brt = new Date(utc.getTime() - 3 * 3600 * 1000);
  const y = brt.getFullYear();
  const m = String(brt.getMonth() + 1).padStart(2, "0");
  const d = String(brt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function main() {
  const res = await fetch(URL, { headers: { "User-Agent": "PluvioRN-Bot" } });
  if (!res.ok) throw new Error(`Falha ao abrir o boletim: HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  // Procura primeiro CSV, depois TXT (links podem ser relativos)
  const pick = (sel) => {
    let href = $(sel).first().attr("href");
    if (!href) return null;
    if (!href.startsWith("http")) href = BASE + href;
    return href;
  };

  let csvHref = pick('a[href*=".csv"], a[href*=".CSV"]');
  let txtHref = pick('a[href*=".txt"], a[href*=".TXT"]');

  mkdirSync("data/archive", { recursive: true });

  const stamp = todayBRTISO();

  if (csvHref) {
    const r = await fetch(csvHref, { headers: { "User-Agent": "PluvioRN-Bot" } });
    if (!r.ok) throw new Error(`CSV indisponível: HTTP ${r.status}`);
    const content = await r.text();
    writeFileSync("data/latest.csv", content, "utf8");
    writeFileSync(`data/archive/${stamp}.csv`, content, "utf8");
    console.log(`OK: CSV salvo em data/latest.csv e data/archive/${stamp}.csv`);
    return;
  }

  if (txtHref) {
    const r = await fetch(txtHref, { headers: { "User-Agent": "PluvioRN-Bot" } });
    if (!r.ok) throw new Error(`TXT indisponível: HTTP ${r.status}`);
    const content = await r.text();
    writeFileSync("data/latest.txt", content, "utf8");
    writeFileSync(`data/archive/${stamp}.txt`, content, "utf8");
    console.log(`OK: TXT salvo em data/latest.txt e data/archive/${stamp}.txt`);
    return;
  }

  throw new Error("Não encontrei links para CSV nem TXT no boletim de hoje.");
}

main().catch((e) => {
  console.error("ERRO:", e.message || e);
  process.exit(1);
});
name: Fetch EMPARN Daily

on:
  schedule:
    # 12:15 UTC ~ 09:15 BRT (ajuste se quiser outro horário)
    - cron: '15 12 * * *'
  workflow_dispatch: {}

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install deps
        run: npm i node-fetch@3 cheerio@1

      - name: Fetch CSV/TXT from EMPARN
        run: node scripts/fetch-emparn.js

      - name: Commit data
        run: |
          git config user.name "pluvio-bot"
          git config user.email "actions@users.noreply.github.com"
          git add data/latest.* data/archive/*
          git commit -m "chore: update EMPARN daily data" || echo "No changes to commit"
          git push

