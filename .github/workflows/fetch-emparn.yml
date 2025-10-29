name: Fetch EMPARN Daily

on:
  schedule:
    - cron: '15 12 * * *'   # 09:15 BRT
  workflow_dispatch: {}      # botão "Run workflow"

jobs:
  fetch:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # necessário para commitar
    steps:
      - uses: actions/checkout@v4

      - name: Run scraper (CSV -> TXT fallback)
        run: node scripts/fetch-emparn.cjs

      - name: Commit files
        run: |
          git config user.name "pluvio-bot"
          git config user.email "actions@users.noreply.github.com"
          git add data/latest.csv data/latest.txt || true
          git commit -m "chore: daily EMPARN snapshot" || echo "no changes"
          git push || true
