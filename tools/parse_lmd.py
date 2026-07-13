#!/usr/bin/env python3
"""Extract "Truths We Love to Teach" (Appendix A) from an lmd_*.epub.

The appendix file is fully self-contained: its body lists topics -> truths
(summary + scripture references), and its footnotes (class="extScrpCite")
hold the full NWT Study Edition verse text for every citation. We reproduce
the QUIZ_DATA schema used by data.js, no translation involved.
"""
import re, sys, json, zipfile, html as htmllib

def clean(s):
    """HTML fragment -> plain text, matching the original data.js cleaning."""
    s = re.sub(r'<sup>.*?</sup>', '', s, flags=re.S)   # drop verse numbers
    s = re.sub(r'<[^>]+>', '', s)                       # drop remaining tags
    s = htmllib.unescape(s)
    s = s.replace('*', '')                             # drop study-note markers
    s = s.replace('​', '')                        # zero-width space
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def find_appendix(zf):
    """The appendix xhtml is the one carrying the extScrpCite footnotes."""
    best, best_n = None, 0
    for name in zf.namelist():
        if not name.endswith('.xhtml'):
            continue
        data = zf.read(name).decode('utf-8', 'replace')
        n = data.count('extScrpCite')
        if n > best_n:
            best, best_n = data, n
    return best

def parse(epub_path):
    zf = zipfile.ZipFile(epub_path)
    html = find_appendix(zf)

    # --- footnotes: citationN -> {ref, text} ---
    foot = {}
    for m in re.finditer(r'id="citation(\d+)".*?</aside>', html, re.S):
        cid = int(m.group(1))
        seg = m.group(0)
        ref_m = re.search(r'<strong>\((.*?)\)</strong>', seg, re.S)
        if not ref_m:
            continue
        ref = clean(ref_m.group(1))
        # verse text lives in the first <p class="extScrpCiteTxt"> only;
        # trailing <p> siblings are study-note glosses ("Or ...") we drop.
        p_m = re.search(r'<p class="extScrpCiteTxt">(.*?)</p>', seg, re.S)
        para = p_m.group(1) if p_m else seg
        after = para.split('</a>', 1)[1] if '</a>' in para else para
        text = clean(after)
        foot[cid] = {'ref': ref, 'text': text}

    # --- body: topics (h2) -> truths (<li> in <ol class="source">) ---
    body = html.split('bodyTxt', 1)[-1]
    # tokens: topic headings and truth list items, in document order
    topics, truths, scriptures = [], [], []
    cur_topic = None
    tid = 0

    # Split the body into ordered chunks of <h2>… and <li>…
    pattern = re.compile(
        r'<h2[^>]*>(?P<h2>.*?)</h2>'
        r'|<li><p[^>]*class="p\d+"[^>]*>(?P<li>.*?)</p>', re.S)
    for m in pattern.finditer(body):
        if m.group('h2') is not None:
            name = clean(m.group('h2'))
            if name:
                cur_topic = name
                if name not in topics:
                    topics.append(name)
        else:
            li = m.group('li')
            num_m = re.search(r'txtSrcBullet"><strong>(\d+)\.', li)
            if not num_m:
                continue
            number = int(num_m.group(1))
            # summary = text before the first scripture citation. Editions vary:
            # English/Portuguese use an em-dash separator, others parenthesize
            # the refs — so cut at the first citation and trim trailing glue.
            cut = re.split(r'<span id="citationsource|<a epub:type="noteref"', li)[0]
            summary = clean(cut)
            summary = re.sub(r'^\d+\.\s*', '', summary)        # strip leading "N."
            summary = re.sub(r'[\s—–(]+$', '', summary).strip()
            # ordered citation ids referenced by this truth
            cids = [int(x) for x in re.findall(r'href="#citation(\d+)"', li)]
            tid += 1
            scr = []
            for c in cids:
                if c in foot:
                    scr.append({'ref': foot[c]['ref'], 'text': foot[c]['text']})
            truths.append({
                'id': tid, 'topic': cur_topic, 'number': number,
                'summary': summary, 'scriptures': scr,
            })
            for s in scr:
                scriptures.append({
                    'ref': s['ref'], 'text': s['text'],
                    'summary': summary, 'topic': cur_topic, 'truthId': tid,
                })

    return {'topics': topics, 'truths': truths, 'scriptures': scriptures}

if __name__ == '__main__':
    data = parse(sys.argv[1])
    print(json.dumps(data, ensure_ascii=False, indent=2))
