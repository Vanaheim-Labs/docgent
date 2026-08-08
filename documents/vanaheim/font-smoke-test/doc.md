---
title: "Font Embedding Smoke Test"
subtitle: "Confirms Inter and Source Serif 4 are selected rather than substituted."
brand: vanaheim
doctype: "Test Fixture"
version: "1.0.0"
date: "2026-08-08"
classification: internal
status: review
---

# Weight axis

Body copy is Source Serif 4 at regular weight. **Bold body copy** exercises the
upper end of the variable weight axis, and *italic body copy* pulls from the
separate italic file rather than synthesising an oblique.

## Heading in Inter

Headings resolve to Inter via the sans token. If this renders in DejaVu Sans or
Liberation Sans, font embedding has failed and the image is substituting.

::: {.keyfigure value="ABCDEFG" label="Inter uppercase, tabular figures 0123456789" trend=none}
The keyfigure value is set in the heading family at large size, which makes
substitution immediately obvious to the eye.
:::

::: {.callout kind=info title="What to look for"}
Inter has a distinctive single-storey lowercase g and a tall x-height. Source
Serif has bracketed serifs and a pronounced vertical stress. If either looks
generic, fontconfig did not find the embedded face.
:::

::: {.pullquote size=large attribution="Weight axis check"}
Handgloves 0123456789 — the quick brown fox jumps over the lazy dog.
:::