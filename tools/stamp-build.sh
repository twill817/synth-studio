#!/bin/sh
# Run before every commit that will be published:  sh tools/stamp-build.sh
#
# Stamps a fresh build number into index.html (the <meta name="build"> tag and every ?v= asset link)
# and into version.txt, so the live site never mixes files from two different updates.
# See the stale-page check at the top of index.html.
set -e
cd "$(dirname "$0")/.."
v=$(date -u +%Y%m%d%H%M%S)
sed -i -e "s/<meta name=\"build\" content=\"[^\"]*\">/<meta name=\"build\" content=\"$v\">/" \
       -e "s/\(\.css\|\.js\)?v=[A-Za-z0-9]*/\1?v=$v/g" index.html
printf '%s\n' "$v" > version.txt
echo "Stamped build $v"
