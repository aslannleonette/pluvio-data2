// Node 20 tem fetch nativo; sem dependências externas.
const fs = require("fs");
const path = require("path");

const BASE = "https://meteorologia.emparn.rn.gov.br";
const URL  = `${BASE}/boletim/diario`;

async function getText(u) {
  const r = await fetch(u, { headers: { "User-Agent": "PluvioRN-Bot/1.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} @ ${u}`);
  return r.text();
}

function abs(href) {
  if (!href) return null;
  return href.startsWith("http") ? href : BASE + href;
}

async function main() {
  console.log("-> Abrindo boletim:", URL);
  const html = await getText(URL);

  // Procura primeiro por link de CSV; se não achar, procura TXT
  const csvMatch = html.match(/href=["']([^"']+\.csv)["']/i);
  const txtMatch = html.match(/href=["']([^"']+\.txt)["']/i);

  console.log("csvMatch:", csvMatch && csvMatch[1]);
  console.log("txtMatch:", txtMatch && txtMatch[1]);

  fs.mkdirSync("data", { recursive: true });

  if (csvMatch) {
    const u = abs(csvMatch[1]);
    console.log("-> Baixando CSV:", u);
    const text = await getText(u);
    fs.writeFileSync(path.join("data", "latest.csv"), text, "utf8");
    console.log("OK: data/latest.csv gravado");
    return;
  }

  if (txtMatch) {
    const u = abs(txtMatch[1]);
    console.log("-> Baixando TXT:", u);
    const text = await getText(u);
    fs.writeFileSync(path.join("data", "latest.txt"), text, "utf8");
    console.log("OK: data/latest.txt gravado");
    return;
  }

  // Se chegou aqui, não achou links na página
  console.error("Nenhum link .csv ou .txt encontrado no boletim.");
  process.exit(1);
}

main().catch(err => {
  console.error("ERRO:", err.stack || err.message);
  process.exit(1);
});
