#!/bin/sh
# Print each dossier page to PDF with headless Chrome (after a deploy).  sh scripts/dossier-pdf.sh
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
for m in $(node -e "console.log(require('./dossiers/index.json').map(x=>x.slug).join(' '))"); do
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir="${TMPDIR:-/tmp}/takar-pdf-chrome" --virtual-time-budget=20000 --print-to-pdf="$(pwd -W 2>/dev/null || pwd)/dossiers/$m.pdf" "https://takar-telegraph.vercel.app/goldrush.html#$m"
done
