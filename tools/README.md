# Data pipeline

These scripts regenerate `../data.js` from the jw.org publication *Love People—
Make Disciples* (`lmd`). **They are a one-off build tool, not part of the app** —
the site itself has no build step and ships the generated `data.js` directly.

Nothing is translated: every topic, truth, reference and verse is the official
jw.org wording for that language, taken from the "Truths We Love to Teach"
appendix (document id `1102023316`).

## Sources per language

| Language | Code | Source |
|----------|------|--------|
| English | `E` | Study-Edition EPUB |
| Spanish | `S` | Study-Edition EPUB |
| German | `X` | Study-Edition EPUB |
| Italian | `I` | Study-Edition EPUB |
| Portuguese (Portugal) | `TPO` | Study-Edition EPUB |
| Polish | `P` | Watchtower Online Library (no Polish EPUB is published) |
| Portuguese (Brazil) | `T` | Watchtower Online Library (no Brazilian EPUB is published) |

The Study-Edition EPUB is ideal because its Appendix A embeds the full New World
Translation verse text in `extScrpCite` footnotes — everything needed is in one
file. Polish has no Study-Edition EPUB, so we scrape the same appendix from
`wol.jw.org` (references) plus WOL's bible-citation endpoint (verse text).

## Regenerating

```bash
mkdir -p work && cd work

# 1. Download the five EPUBs. Get each URL from the public pub-media API, e.g.:
#    https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS?pub=lmd&langwritten=E&fileformat=EPUB&output=json
#    (langwritten = E, S, X, I, TPO). Then:
curl -L -o lmd_E.epub "<url for E>"      # repeat for S, X, I, TPO

# 2. Extract each EPUB to lmd_<code>.json (validates 9 topics / 34 truths / 85 scriptures):
for L in E S X I TPO; do python3 ../parse_lmd.py lmd_$L.epub > lmd_$L.json; done

# 3. Extract the WOL-sourced languages (fetches 85 verse citations each).
#    Args are: wtlang rsconf lib — discover them with WOL's finder (see the
#    script header). Defaults are Polish.
python3 ../parse_lmd_wol.py pl r12 lp-p > lmd_P.json   # Polish
python3 ../parse_lmd_wol.py pt r5  lp-t > lmd_T.json   # Brazilian Portuguese

# 4. Combine into ../data.js:
python3 ../build_data.py .
```

`parse_lmd.py` is validated to reproduce the original English `data.js`
byte-for-byte, so it is the reference for what "correct" extraction looks like.

## Notes

- The EPUB editions differ in how they separate a truth's summary from its
  references (em-dash vs. parenthesised list); `parse_lmd.py` handles both.
- WOL splits poetic verses into per-line `<span>`s with no whitespace between
  them; `parse_lmd_wol.py` converts those boundaries to spaces so words don't
  glue together.
- Polish references use full book names (e.g. "Mateusza 24:3") because that is
  what WOL returns; the EPUB languages use the abbreviations from their footnotes.
- UI strings live in `../i18n.js`, not here — those are localized interface
  chrome with no brochure equivalent.
