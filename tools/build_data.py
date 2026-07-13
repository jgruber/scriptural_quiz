#!/usr/bin/env python3
"""Combine the six per-language extractions into ../data.js.

Reads lmd_<code>.json files from a work directory (default: current dir) and
writes data.js next to the app. See README.md for the full pipeline.
"""
import json, os, sys

WORKDIR = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(os.path.dirname(__file__), "..", "data.js")

LANGS = [
    ("en", "lmd_E.json",   "Truths We Love to Teach"),
    ("es", "lmd_S.json",   "Verdades bíblicas que nos encanta enseñar"),
    ("de", "lmd_X.json",   "Wahrheiten, über die wir gern sprechen"),
    ("pl", "lmd_P.json",   "Prawdy, o których lubimy rozmawiać"),
    ("it", "lmd_I.json",   "Verità bibliche che desideriamo insegnare"),
    ("pt", "lmd_TPO.json", "Verdades que gostamos muito de ensinar"),
]

out = {}
for code, path, title in LANGS:
    d = json.load(open(os.path.join(WORKDIR, path)))
    assert len(d["truths"]) == 34, f"{code}: {len(d['truths'])} truths"
    assert len(d["scriptures"]) == 85, f"{code}: {len(d['scriptures'])} scriptures"
    out[code] = {
        "appendixTitle": title,
        "topics": d["topics"],
        "truths": d["truths"],
        "scriptures": d["scriptures"],
    }

body = json.dumps(out, ensure_ascii=False, indent=2)
header = (
    "/* Scriptural data for the quiz, one entry per language.\n"
    " *\n"
    " * Extracted verbatim from the \"Truths We Love to Teach\" appendix of the\n"
    " * jw.org brochure \"Love People\\u2014Make Disciples\" (lmd) in each language:\n"
    " * English/Spanish/German/Italian/Portuguese from the Study-Edition EPUBs,\n"
    " * Polish from the Watchtower Online Library. Nothing here is translated;\n"
    " * every topic, truth and verse is the official jw.org wording.\n"
    " *\n"
    " * Regenerate with tools/build_data.py — see tools/README.md.\n"
    " *\n"
    " * Shape: QUIZ_DATA_BY_LANG[lang] = { appendixTitle, topics, truths, scriptures }.\n"
    " */\n"
)
with open(OUT, "w") as f:
    f.write(header + "window.QUIZ_DATA_BY_LANG = " + body + ";\n")
print("wrote data.js:", {c: len(out[c]["scriptures"]) for c in out})
