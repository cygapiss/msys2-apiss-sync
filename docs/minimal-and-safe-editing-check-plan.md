# minimal-and-safe-editing-check plan

Standalone reference behavior summary:

| Area | Markdown normalizer behavior | Commit message normalizer behavior |
|------|-------------------------------|------------------------------------|
| Target scope | Multiple files: markdown plus selected source extensions | Single commit message file |
| Selection control | Root scanning with repeatable root arguments | One explicit path argument with default |
| Text region handling | Full file for markdown, comments-only for code files | Full file normalization |
| Normalization rules | Replace smart punctuation and mojibake with ASCII equivalents | Same ASCII-safe punctuation policy |
| Encoding output | UTF-8 no BOM, LF newlines | UTF-8 no BOM, LF newlines |
| Control chars | Keep normal text and line structure | Strip disallowed controls except tab/newline |
| Check mode | `--check` exits non-zero when any file would change | `--check` exits non-zero when file would change |
| Write mode | Rewrites only files requiring normalization | Rewrites only when normalization is needed |
| Result reporting | Deterministic stale file list and summary | Clear normalized/already-clean status |

Normalization rule expectations for this plan:

| Input pattern | Output form |
|---------------|-------------|
| Em dash or en dash | `-` |
| Unicode arrow or common mojibake arrow forms | `->` |
| Unicode ellipsis or common mojibake ellipsis forms | `...` |
| Smart quotes and NBSP variants | ASCII quote/space equivalents |

Full normalization symbol map (source-aligned):

| Input (Unicode/code point form) | Output |
|----------------------------------|--------|
| `U+2014` em dash | `-` |
| `U+2013` en dash | `-` |
| `U+2212` minus sign | `-` |
| `U+2018`, `U+2019`, `U+201A`, `U+201B` | `'` |
| `U+201C`, `U+201D`, `U+201E`, `U+201F` | `"` |
| `U+2032` prime | `'` |
| `U+2033` double prime | `"` |
| `U+2026` ellipsis | `...` |
| `U+00A0` no-break space | space |
| `U+FEFF` BOM | removed |
| `U+2192` right arrow | `->` |
| `U+2194` left-right arrow | `<->` |
| `U+2193` down arrow | `v` |
| `U+25BA`, `U+25B6` right-pointing symbols | `>` |
| `U+00A1 U+00AA` | `-` |
| `U+00A1 U+00B0`, `U+00A1 U+00AF` | `'` |
| `U+00A1 U+00C0`, `U+00A1 U+00B1` | `"` |
| `U+00A1 U+00AD` | `...` |
| `U+00A1 U+00FA` | `->` |

Byte-level fix map used before/with decode:

| Input bytes (hex) | Meaning/source pattern | Output bytes/text |
|-------------------|------------------------|-------------------|
| `E2 80 94` | UTF-8 em dash | `-` |
| `E2 80 93` | UTF-8 en dash | `-` |
| `E2 80 9C`, `E2 80 9D` | UTF-8 double smart quotes | `"` |
| `E2 80 98`, `E2 80 99` | UTF-8 single smart quotes | `'` |
| `E2 80 A6` | UTF-8 ellipsis | `...` |
| `C2 A0` | UTF-8 NBSP | space |
| `E2 80 3F` | truncated UTF-8 dash form | `-` |
| `E2 86 3F` | truncated UTF-8 arrow form | `->` |
| `A1 AA` | Latin-1 mojibake dash form | `-` |
| `A1 B0`, `A1 AF` | Latin-1 mojibake single quote forms | `'` |
| `A1 C0`, `A1 B1` | Latin-1 mojibake double quote forms | `"` |
| `A1 AD` | Latin-1 mojibake ellipsis form | `...` |
| `A1 FA` | Latin-1 mojibake arrow form | `->` |
| `C2 A1 C2 AD` | UTF-8 mojibake ellipsis form | `...` |
| `C2 A1 C3 BA` | UTF-8 mojibake arrow form | `->` |
| `E2 86 92` | UTF-8 rightwards arrow | `->` |
| `96`, `97` | CP1252 en/em dash in mixed files | `-` |
| `32 A8 43` (`2\xa8C`) | repo-specific byte pattern | `2-` |

Implementation expectations:

- Provide `--check` mode for CI/guard use (no writes; non-zero on violations)
- Provide write mode for optional one-shot normalization
- Enforce strict UTF-8 decode and ASCII punctuation normalization
- Keep output deterministic and parseable
- Keep scope minimal and support allowlist paths to avoid unrelated rewrites
