---
title: "DocForge Component Gallery"
subtitle: "Every semantic construct in the vocabulary, rendered. This document is the visual regression test."
brand: vanaheim
doctype: "Reference Document"
version: "1.0.0"
date: "2026-08-08"
client: "Vanaheim Partners"
author: "DocForge"
classification: internal
status: approved
reference: "DF-REF-001"
toc: true
---

::: summary
## Executive summary

This gallery exercises every block in the DocForge vocabulary registry. If a construct
renders incorrectly here, it will render incorrectly everywhere. Treat a visual diff on
this document as a build failure.
:::

# Typography

Body copy is set in the brand serif at 10.5pt with a 1.55 line height, justified with
hyphenation enabled. The measure is controlled by page margins rather than a max-width,
so it stays consistent across A4 and Letter geometries.

Inline constructs include [defined terms]{.term}, *emphasis*, **strong emphasis**, and
footnotes^[Footnotes are collected at the end of the document by pandoc, then styled by
the base stylesheet.].

## Second-level heading

Numbering is applied automatically to level one and level two headings via a Lua filter,
using CSS counters rather than baked-in text.

### Third-level heading

Third-level headings are unnumbered and set in the soft ink tone to establish hierarchy
without adding visual weight.

# Emphasis blocks

::: callout
Default callout with no kind attribute. Used for neutral asides that support the body
copy without implying urgency.
:::

::: {.callout kind=info title="Scope note"}
Callouts accept an optional title. The title renders in the accent colour in uppercase
sans, which reads as a label rather than a heading.
:::

::: {.callout kind=warning title="Timing risk"}
Warning callouts shift to the amber palette. Reserve these for genuine schedule or
delivery risk, not general commentary.
:::

::: {.callout kind=risk title="Material risk"}
Risk callouts use the red palette and should be rare. Overuse destroys their signal
value.
:::

::: {.callout kind=success title="Resolved"}
Success callouts confirm a resolved issue or a met condition.
:::

::: {.pullquote attribution="Engagement principle"}
The market moved before anyone noticed, which is the ordinary condition of markets
rather than an exceptional one.
:::

::: {.pullquote size=large attribution="Vanaheim Partners"}
Design systems fail at the point where an author needs something the vocabulary does
not provide.
:::

# Data presentation

::: {.keyfigure value="$4.2M" label="Annualised run rate" trend=up}
Up from $2.8M at the prior review. Growth is concentrated in the enterprise segment,
which now represents 61% of contracted revenue.
:::

::: {.keyfigure value="12.4%" label="Churn, trailing twelve months" trend=down}
Improved from 18.1%. The reduction follows the onboarding changes shipped in Q1.
:::

::: {.datatable caption="Segment performance, FY26 year to date"}
| Segment | Revenue | Growth | Margin |
|---|---|---|---|
| Enterprise | $2,560,000 | +42% | 68% |
| Mid-market | $1,120,000 | +18% | 61% |
| Small business | $420,000 | -6% | 44% |
| Public sector | $100,000 | +130% | 71% |
:::

::: {.datatable dense=true caption="Dense variant for long reference tables"}
| Ref | Item | Owner | Due |
|---|---|---|---|
| A-01 | Contract review | Legal | 14 Aug |
| A-02 | Pricing model refresh | Finance | 21 Aug |
| A-03 | Integration testing | Engineering | 28 Aug |
| A-04 | Customer comms plan | Marketing | 4 Sep |
:::

A bare pipe table without the wrapper also receives sensible default styling:

| Metric | Q1 | Q2 |
|---|---|---|
| Active accounts | 1,240 | 1,690 |
| Support tickets | 310 | 268 |

# Recommendations

::: {.recommendation ref="R1" priority=critical owner="Executive"}
Consolidate the three overlapping pricing tiers into a single published schedule before
the next renewal cycle. The current structure creates negotiation drag on every deal.
:::

::: {.recommendation ref="R2" priority=high owner="Engineering"}
Migrate the reporting pipeline off the legacy scheduler. The existing implementation has
no retry semantics and fails silently.
:::

::: {.recommendation ref="R3" priority=medium owner="Operations"}
Introduce a quarterly review of supplier terms. Current contracts roll over automatically
with no evaluation gate.
:::

# Multi-column flow

::: {.columns count=2}
Column regions are useful for glossaries, long enumerations, and dense reference content
where a full-measure line would be uncomfortably long to read.

The base stylesheet sets an 8mm gutter and reduces type size slightly in three-column
mode. Break control inside columns is left to the renderer, which handles it correctly
in WeasyPrint.

Avoid placing callouts, figures, or tables inside column regions.
:::

# Glossary

::: {.definition term="Vocabulary registry"}
The closed list of semantic block types available to authors. Enforced at validation time.
:::

::: {.definition term="Brand overlay"}
A token file and optional stylesheet that customises the base design system for a
particular brand without forking it.
:::

::: {.definition term="Content addressing"}
Binding each rendered artefact to the commit SHA of its source, so any historical version
can be reproduced exactly.
:::

::: appendix

# Appendix A: Structural controls

Appendices begin on a new page and switch the running header. Explicit page breaks are
available but should be used sparingly.

::: {.callout kind=note title="Authoring guidance"}
If you find yourself reaching for an explicit page break to fix a layout problem, the
underlying issue is usually a missing break-inside rule on a component. Fix the
stylesheet, not the document.
:::

::: {.signature name="Andrew Julian" role="Vanaheim Partners" date="8 August 2026"}
Prepared and reviewed under the DocForge production system.
:::

:::
