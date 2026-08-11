---
title: "{{title}}"
subtitle: "{{subtitle}}"
brand: inkl
doctype: "Strategic Report"
version: "{{version}}"
date: "{{date}}"
author: "{{author}}"
classification: confidential
status: draft
toc: true
---

<!-- SECTION AUTHORING NOTE (inkl brand):
     Use the section eyebrow to carry the section number and name.
     The H1 should be the BARE section title only — no number prefix.
     This populates the running header correctly without double-counting.

     CORRECT:
       # 01 · BUSINESS OVERVIEW    ← section eyebrow (orange, sets left header)
       # Business Overview          ← H1 (sets right header, appears in body)

     INCORRECT:
       # 01 · BUSINESS OVERVIEW    ← eyebrow
       # 01 · Business Overview    ← H1 WITH number → double-counts in header

     In doc.md syntax:
       ::: section-number
       01 · SECTION NAME
       :::

       # Section Name
-->

::: summary
## Executive Summary

{{summary}}
:::

# Background

{{background}}

# Analysis

{{analysis}}

# Recommendations

{{recommendations}}

# Next Steps

{{next_steps}}
