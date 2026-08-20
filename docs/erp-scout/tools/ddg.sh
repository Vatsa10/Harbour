#!/usr/bin/env bash
# ddg.sh "query" [region] [pages] — DuckDuckGo HTML search. No API key, no quota.
# region defaults to in-en (India). Output: URL <TAB> TITLE
set -uo pipefail
q="${1:?usage: ddg.sh \"query\" [region] [pages]}"
region="${2:-in-en}"
pages="${3:-1}"
UA="Mozilla/5.0"

for ((p=0; p<pages; p++)); do
  curl -s -m 30 -A "$UA" --data-urlencode "q=$q" --data "kl=$region&s=$((p*30))" \
       "https://html.duckduckgo.com/html/" \
  | tr '<' '\n' | grep 'class="result__a"' \
  | sed -e 's/.*href="//' -e 's/">/\t/' -e 's/<.*//' \
  | while IFS=$'\t' read -r url title; do
      case "$url" in
        //duckduckgo.com/l/*) url="${url#*uddg=}"; url="${url%%&amp;rut=*}"
                              url=$(printf '%b' "$(printf '%s' "$url" | sed 's/+/ /g; s/%/\x/g')") ;;
      esac
      printf '%s\t%s\n' "$url" "${title:-(no title)}"
    done
  [ "$pages" -gt 1 ] && sleep 2
done
