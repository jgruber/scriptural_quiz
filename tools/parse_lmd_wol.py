#!/usr/bin/env python3
"""Extract the Polish "Truths We Love to Teach" (Appendix A) from wol.jw.org.

Polish has no Study-Edition EPUB, so we scrape the same appendix document
(id 1102023316) from the Watchtower ONLINE Library: topics + truths + scripture
references come from the appendix page, and each scripture's full NWT text comes
from WOL's bible-citation (bc) endpoint. No translation — authentic jw.org data.
"""
import re, sys, json, time, subprocess, html as htmllib

DOCID = "1102023316"
APPENDIX_URL = f"https://wol.jw.org/pl/wol/d/r12/lp-p/{DOCID}"
BC_URL = "https://wol.jw.org/wol/bc/r12/lp-p/" + DOCID + "/{}/{}"
UA = {"User-Agent": "Mozilla/5.0"}

def get(url):
    last = None
    for attempt in range(5):
        try:
            out = subprocess.run(
                ["curl", "-sL", "--max-time", "30", "-A", "Mozilla/5.0", url],
                capture_output=True, timeout=40)
            if out.returncode == 0 and out.stdout:
                return out.stdout.decode("utf-8", "replace")
            last = RuntimeError(f"curl rc={out.returncode}")
        except Exception as e:
            last = e
        time.sleep(1 + attempt)
    raise last

def clean(s):
    s = re.sub(r'<sup>.*?</sup>', '', s, flags=re.S)
    s = re.sub(r'<a\b[^>]*>.*?</a>', '', s, flags=re.S)  # verse #s + xref "+"
    # Poetic verse lines are separate <span>s with no whitespace between them;
    # turn line/block boundaries into spaces so words don't glue together.
    s = re.sub(r'</(span|p|div|li)>|<br\s*/?>', ' ', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    s = htmllib.unescape(s)
    s = s.replace('*', '').replace('​', '')
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def main():
    html = get(APPENDIX_URL)
    body = html.split('bodyTxt', 1)[-1] if 'bodyTxt' in html else html

    # bc endpoint cache (persisted so reruns resume): "g/i" -> raw {title, content}.
    # We cache the RAW payload and clean at use, so fixing clean() needs no refetch.
    import os
    CACHE_FILE = "/tmp/wol_bc_raw.json"
    cache = json.load(open(CACHE_FILE)) if os.path.exists(CACHE_FILE) else {}
    def fetch_bc(g, i):
        key = f"{g}/{i}"
        if key not in cache:
            data = json.loads(get(BC_URL.format(g, i)))
            it = data['items'][0]
            cache[key] = {'title': it['title'], 'content': it['content']}
            json.dump(cache, open(CACHE_FILE, 'w'), ensure_ascii=False)
            time.sleep(0.15)
        raw = cache[key]
        return {'ref': clean(raw['title']), 'text': clean(raw['content'])}

    topics, truths, scriptures = [], [], []
    cur_topic, tid = None, 0
    pattern = re.compile(
        r'<h2[^>]*>(?P<h2>.*?)</h2>'
        r'|<li><p[^>]*id="p\d+"[^>]*>(?P<li>.*?)</p>', re.S)
    for m in pattern.finditer(body):
        if m.group('h2') is not None:
            name = clean(m.group('h2'))
            if name and name not in topics:
                topics.append(name)
            if name:
                cur_topic = name
        else:
            li = m.group('li')
            num_m = re.search(r'txtSrcBullet"><strong>(\d+)\.', li)
            if not num_m:
                continue
            number = int(num_m.group(1))
            cut = re.split(r'<a\b', li)[0]
            summary = clean(cut)
            summary = re.sub(r'^\d+\.\s*', '', summary)
            summary = re.sub(r'[\s—–(]+$', '', summary).strip()
            paths = re.findall(r'/pl/wol/bc/r12/lp-p/' + DOCID + r'/(\d+)/(\d+)', li)
            tid += 1
            scr = []
            for g, i in paths:
                bc = fetch_bc(g, i)
                scr.append({'ref': bc['ref'], 'text': bc['text']})
            truths.append({'id': tid, 'topic': cur_topic, 'number': number,
                           'summary': summary, 'scriptures': scr})
            for s in scr:
                scriptures.append({'ref': s['ref'], 'text': s['text'],
                                   'summary': summary, 'topic': cur_topic, 'truthId': tid})
        sys.stderr.write(f"\rtruths={tid} scriptures={len(scriptures)} bc_cached={len(cache)}")
        sys.stderr.flush()
    sys.stderr.write("\n")
    print(json.dumps({'topics': topics, 'truths': truths, 'scriptures': scriptures},
                     ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
