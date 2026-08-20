#!/usr/bin/env bash
# bing.sh "query" [cc] [pages] — Bing HTML search, decodes bing redirect URLs.
# cc defaults to IN (India). Output: URL <TAB> TITLE
set -uo pipefail
q="${1:?usage: bing.sh \"query\" [cc] [pages]}"
cc="${2:-IN}"
pages="${3:-1}"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

for ((p=0; p<pages; p++)); do
  first=$((p*10+1))
  curl -s -m 25 -A "$UA" -H "Accept-Language: en-IN,en;q=0.9" \
       --data-urlencode "q=$q" --data "cc=$cc" --data "first=$first" \
       "https://www.bing.com/search" \
  | tr '<' '\n' \
  | grep -oP '(?:href="\Khttps://www\.bing\.com/ck/a\?[^"]*|href="\Khttps?://(?!www\.bing\.com|r\.bing\.com|go\.microsoft\.com)[^"]*)' \
  | while IFS= read -r raw; do
      if [[ "$raw" == *"u=a1"* ]]; then
        b64=$(printf '%s' "$raw" | sed -E 's/.*u=a1([A-Za-z0-9_-]+).*/\1/' | sed 's/&amp;.*//')
        # bing uses url-safe base64 without padding sometimes
        b64="${b64//-/+}"; b64="${b64//_/\/}"
        pad=$(( (4 - ${#b64} % 4) % 4 ))
        for ((i=0;i<pad;i++)); do b64="${b64}="; done
        url=$(printf '%s' "$b64" | base64 -d 2>/dev/null)
        [ -n "$url" ] && printf '%s\n' "$url"
      else
        printf '%s\n' "$raw" | sed 's/&amp;.*//'
      fi
    done \
  | awk '!seen[$0]++'
  [ "$pages" -gt 1 ] && sleep 1
done
