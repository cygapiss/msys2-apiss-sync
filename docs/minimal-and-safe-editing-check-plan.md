# minimal-and-safe-editing-check plan

Encoding baseline: UTF-8 (no BOM preferred) for this and all plan files.

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

GBK non-ASCII punctuation to ASCII mapping:

| GBK/CP936 bytes | Symbol/meaning | ASCII output |
|-----------------|----------------|--------------|
| `A1 AA` | em dash | `-` |
| `A8 43` | en dash | `-` |
| `A1 AE`, `A1 AF` | single smart quotes | `'` |
| `A1 B0`, `A1 B1` | double smart quotes | `"` |
| `A1 AD` | ellipsis | `...` |
| `A1 EB` | per mille sign | `%` |
| `A1 FA` | right arrow | `->` |
| `A1 FD` | down arrow | `v` |

UTF-8 non-ASCII punctuation to ASCII mapping:

| UTF-8 bytes | Symbol (code point) | ASCII output |
|-------------|---------------------|--------------|
| `E2 80 94` | em dash (`U+2014`) | `-` |
| `E2 80 93` | en dash (`U+2013`) | `-` |
| `E2 88 92` | minus sign (`U+2212`) | `-` |
| `E2 80 98`, `E2 80 99` | single smart quotes (`U+2018`, `U+2019`) | `'` |
| `E2 80 9C`, `E2 80 9D` | double smart quotes (`U+201C`, `U+201D`) | `"` |
| `E2 80 A6` | ellipsis (`U+2026`) | `...` |
| `E2 80 9A` | single low-9 quote (`U+201A`) | `'` |
| `E2 80 9E` | double low-9 quote (`U+201E`) | `"` |
| `C2 A0` | no-break space (`U+00A0`) | space |
| `E2 80 A2` | bullet (`U+2022`) | `-` |
| `E2 80 B9` | single left angle quote (`U+2039`) | `<` |
| `E2 80 BA` | single right angle quote (`U+203A`) | `>` |
| `E2 80 B0` | per mille sign (`U+2030`) | `%` |
| `E2 86 92` | right arrow (`U+2192`) | `->` |
| `E2 86 94` | left-right arrow (`U+2194`) | `<->` |
| `E2 86 93` | down arrow (`U+2193`) | `v` |
| `E2 96 BA` | right-pointing pointer (`U+25BA`) | `>` |
| `E2 96 B6` | right-pointing triangle (`U+25B6`) | `>` |
| `EF BB BF` (mid-file only) | UTF-8 BOM / `U+FEFF` appearing inside content | removed |

CP1252 non-ASCII punctuation to ASCII mapping:

| CP1252 bytes | Symbol/meaning | ASCII output |
|--------------|----------------|--------------|
| `96` | en dash | `-` |
| `97` | em dash | `-` |
| `91`, `92` | single smart quotes | `'` |
| `93`, `94` | double smart quotes | `"` |
| `82` | single low-9 quote | `'` |
| `84` | double low-9 quote | `"` |
| `85` | ellipsis | `...` |
| `8B` | single left angle quote | `<` |
| `9B` | single right angle quote | `>` |
| `95` | bullet | `-` |
| `89` | per mille sign | `%` |

Implementation expectations:

- Provide `--check` mode for CI/guard use (no writes; non-zero on violations).
- Provide write mode for optional one-shot normalization.
- Apply the three mapping tables above in deterministic order.
- Decode input with strict UTF-8 first; if decode fails, apply configured fallback
  decoding only for files in fallback scope.
- Normalize line endings to LF and keep output in UTF-8 (no BOM).
- Do not strip a file-leading UTF-8 BOM (first three bytes); only normalize
  `U+FEFF` when it appears in the middle of content.
- Emit parseable failures in `path:line:reason` format.
- Keep scope minimal and support allowlist paths to avoid unrelated rewrites.
- Treat Unicode `General_Category=P*` as candidate punctuation coverage; the three
  tables above define the concrete normalization subset for this project.

P* extension policy:

| Case | Behavior in check mode | Behavior in write mode |
|------|-------------------------|------------------------|
| Punctuation in mapping tables | Report as fixable normalization | Rewrite to mapped ASCII output |
| Punctuation in `P*` but not mapped | Report as unsupported punctuation candidate | Keep unchanged (no silent rewrite) |
| Punctuation in allowlist | Ignore for failure purposes | Keep unchanged |

Required test cases:

| Test ID | Input type | Example input | Expected result |
|---------|------------|---------------|-----------------|
| `utf8-known-dash` | UTF-8 mapped punctuation | `U+2014`, `U+2013` | normalized to `-` |
| `utf8-known-quotes` | UTF-8 mapped punctuation | `U+2018/U+2019`, `U+201C/U+201D` | normalized to `'` and `"` |
| `utf8-known-ellipsis` | UTF-8 mapped punctuation | `U+2026` | normalized to `...` |
| `utf8-known-arrow` | UTF-8 mapped punctuation | `U+2192`, `U+2194`, `U+2193` | normalized to `->`, `<->`, `v` |
| `gbk-known-dash` | GBK fallback decode | bytes `A1 AA`, `A8 43` | normalized to `-` |
| `gbk-known-quotes` | GBK fallback decode | bytes `A1 AE/A1 AF`, `A1 B0/A1 B1` | normalized to `'` and `"` |
| `cp1252-known-dash` | CP1252 fallback decode | bytes `96`, `97` | normalized to `-` |
| `cp1252-known-quotes` | CP1252 fallback decode | bytes `91/92`, `93/94`, `82`, `84` | normalized to `'` and `"` |
| `cp1252-known-ellipsis` | CP1252 fallback decode | byte `85` | normalized to `...` |
| `bom-leading-keep` | UTF-8 BOM boundary | BOM at file start only | preserved (not removed) |
| `bom-mid-remove` | UTF-8 BOM boundary | `U+FEFF` in middle | removed |
| `pstar-unmapped-check` | `P*` candidate coverage | punctuation not in mapping tables | check mode fails with `path:line:reason` |
| `pstar-unmapped-write` | `P*` candidate coverage | punctuation not in mapping tables | unchanged, reported as unsupported |
| `allowlist-unmapped` | allowlist behavior | unmapped punctuation in allowlisted path | no failure |
| `deterministic-order` | output stability | same file set, repeated run | same diagnostics order and content |
| `check-no-write` | mode contract | run with `--check` | no file content changes |
| `write-idempotent` | mode contract | run write mode twice | second run reports no changes |
