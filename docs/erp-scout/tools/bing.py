#!/usr/bin/env python3
"""bing.py "query" [cc] [pages] -- Bing HTML search restricted to organic results.
Output: URL <TAB> TITLE  (one per line)
"""
import sys, re, html, base64, urllib.request, urllib.parse, time

def decode_bing_redirect(url):
    m = re.search(r'[?&]u=a1([A-Za-z0-9_-]+)', url)
    if not m:
        return url
    b64 = m.group(1).replace('-', '+').replace('_', '/')
    b64 += '=' * (-len(b64) % 4)
    try:
        return base64.b64decode(b64).decode('utf-8', 'replace')
    except Exception:
        return url

def fetch(query, cc, first):
    q = urllib.parse.quote(query)
    url = f"https://www.bing.com/search?q={q}&cc={cc}&first={first}&setlang=en"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept-Language": "en-IN,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read().decode('utf-8', 'replace')

def parse(body):
    results = []
    # organic results live in <li class="b_algo" ...> ... <h2><a href="URL">TITLE</a></h2>
    for block in re.findall(r'<li class="b_algo".*?</li>', body, re.S):
        m = re.search(r'<h2[^>]*>\s*<a[^>]*?href="([^"]+)"[^>]*>(.*?)</a>', block, re.S)
        if not m:
            continue
        url = html.unescape(m.group(1))
        title = re.sub(r'<[^>]+>', '', m.group(2))
        title = html.unescape(title).strip()
        url = decode_bing_redirect(url)
        results.append((url, title))
    return results

def main():
    if len(sys.argv) < 2:
        print("usage: bing.py \"query\" [cc] [pages]", file=sys.stderr)
        sys.exit(1)
    query = sys.argv[1]
    cc = sys.argv[2] if len(sys.argv) > 2 else "IN"
    pages = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    seen = set()
    for p in range(pages):
        first = p * 10 + 1
        try:
            body = fetch(query, cc, first)
        except Exception as e:
            print(f"# fetch error: {e}", file=sys.stderr)
            continue
        for url, title in parse(body):
            if url in seen:
                continue
            seen.add(url)
            print(f"{url}\t{title}")
        if pages > 1:
            time.sleep(1)

if __name__ == "__main__":
    main()
