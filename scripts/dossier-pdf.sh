#!/bin/sh
# Print each dossier page to PDF with headless Chrome (after a deploy).  sh scripts/dossier-pdf.sh
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
for m in mount-morgan brilliant-lode mount-leyshon; do
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=20000 --print-to-pdf="dossiers/$m.pdf" "https://takar-telegraph.vercel.app/goldrush.html#$m"
done
