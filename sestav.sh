#!/bin/sh
# Sestaví web z původních projektů (zdroje zůstávají tam, kde jsou; sem se jen kopírují).
#   sh sestav.sh   -> pak git add -A && git commit && git push
set -e
cd "$(dirname "$0")"
HLIDAC="$HOME/Ronja AI"
F1="$HOME/Documents/Ronja"

rm -rf hlidac-klidu f1
mkdir -p hlidac-klidu/trenink f1

# Hlídač klidu: hra + trénink sítě
cp "$HLIDAC/dist/index.html" hlidac-klidu/index.html
cp -r "$HLIDAC/hlidac-ai/js" "$HLIDAC/hlidac-ai/css" "$HLIDAC/hlidac-ai/README.md" hlidac-klidu/trenink/
# train.html odkazuje na hru přes ../dist/index.html – tady leží hra o složku výš
sed 's#href="\.\./dist/index\.html"#href="../index.html"#' "$HLIDAC/hlidac-ai/train.html" > hlidac-klidu/trenink/index.html

# F1 závody: hra + trénink (bez nástrojů pro Node.js)
cp -r "$F1/index.html" "$F1/train.html" "$F1/js" "$F1/css" "$F1/README.md" f1/

echo "hotovo: $(find hlidac-klidu f1 -type f | wc -l) souborů"
