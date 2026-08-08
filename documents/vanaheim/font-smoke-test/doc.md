---
title: "Font Embedding Smoke Test"
subtitle: "Confirms Inter and Source Serif 4 are selected rather than substituted."
brand: vanaheim
doctype: "Test Fixture"
version: "1.0.0"
date: "2026-08-08"
classification: internal
status: approved
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

Absolutely — I’d turn it into a **real document-production torture test**, where the content itself traces the evolution from scribal production through metal type, phototypesetting, PostScript, desktop publishing, PDF and variable fonts. That gives you far more useful material for spotting differences in serif texture, italics, weights, numerals, punctuation and long-form rendering.

# Font Embedding Smoke Test

This document is deliberately more elaborate than a conventional font test. It uses the history of document production as its subject because that history is, in large part, the history of typography becoming progressively more reproducible.

A manuscript copied by a scribe, a page assembled from movable metal type, a Linotype slug, a strip of phototypeset text, a PostScript file sent to an imagesetter, and a modern PDF produced inside a container all solve versions of the same problem:

> How do we make the page produced over there look like the page intended here?

Font embedding is simply the latest chapter in a very old production problem.

# Weight axis

Body copy is Source Serif 4 at regular weight. **Bold body copy** exercises the upper end of the variable weight axis, while *italic body copy* pulls from the separate italic face rather than synthesising an oblique.

A useful test sentence contains more than alphabetic characters. It should expose punctuation, numerals, spacing, kerning and the relationship between roman and italic forms:

**The compositor charged £1,284.50 for 37½ pages — “including corrections”, apparently — on 12 September 1926.**

The distinction between true italic and mechanically slanted roman type matters. Historically, italic was not conceived merely as a tilted version of the normal face. It developed as a separate style of writing and printing, with its own proportions, joins and letterforms. A genuine italic therefore changes the construction of characters such as *a*, *f*, *g* and *y*, rather than simply leaning them to the right.

## Heading in Inter

Headings resolve to Inter via the sans token. If this renders in DejaVu Sans or Liberation Sans, font embedding has failed and the image is substituting.

Sans-serif typefaces are themselves products of a comparatively recent period in printing history. Early nineteenth-century printers sometimes described the new unadorned forms as *grotesques*. What initially appeared strange eventually became one of the dominant typographic languages of industrial, institutional and digital communication.

::: {.keyfigure value="ABCDEFG" label="Inter uppercase, tabular figures 0123456789" trend=none}
The keyfigure value is set in the heading family at large size, which makes substitution immediately obvious to the eye.
:::

::: {.callout kind=info title="What to look for"}
Inter has a distinctive single-storey lowercase g and a tall x-height. Source Serif has bracketed serifs and a pronounced vertical stress. Compare a, g, R, Q, 1, 3, 6, 8 and the ampersand. If either family looks generic, fontconfig may not have found the embedded face.
:::

# Before printing: the page as an artefact

For most of the history of written documents, every copy was itself an act of production.

A medieval manuscript did not have a separate abstract “document” that could simply be rendered again. The vellum, ruling, handwriting, pigments, abbreviations, corrections and decoration were the document. Reproduction meant another human being making another object.

That has an interesting consequence: variation was expected.

Two copies of substantially the same text might differ in line length, spelling, ornamentation, pagination and even content. Modern readers tend to regard these differences as defects. Manuscript cultures often treated them as an ordinary consequence of transmission.

The modern expectation that a document should reappear *identically* on another machine would have been almost meaningless.

# Movable type: separating content from impression

Printing with movable type changed that relationship.

Individual pieces of type could be assembled into lines, lines into formes, and formes repeatedly impressed onto sheets of paper. The physical arrangement of type became a reusable intermediate representation of the page.

In software terms, the forme was almost executable.

It contained the instructions necessary to produce another instance of the page, provided the press, ink, paper and operator behaved as expected.

But even here, reproduction was not perfectly deterministic. Different impressions could vary because of ink, packing, paper moisture, pressure and wear. Corrections introduced during a print run could create multiple states of what appears, bibliographically, to be the same edition.

The supposedly fixed printed page has always been slightly less fixed than it looks.

## The compositor's world

Traditional typesetting also made typography physical in a way that is easy to forget.

A compositor did not choose “11 pt Source Serif”. They worked with actual pieces of metal possessing a fixed body size. Width was physical. Leading was literally strips of lead placed between lines. Spaces were objects. A line could be too long in the most literal possible sense: it did not fit.

Justification therefore involved manipulating the distribution of physical space.

The terminology survives long after the machinery has disappeared:

* leading;
* point size;
* upper case and lower case;
* composing;
* type;
* font;
* galley;
* stereotype;
* cliché.

Digital publishing is full of metaphors inherited from workshops that most users have never seen.

# Type size was not always a number

Before point systems became standardised, type sizes were commonly identified by names such as *pica*, *brevier*, *long primer* and *nonpareil*.

Those names did not necessarily describe precisely identical dimensions between foundries.

The apparently innocent modern declaration:

`font-size: 11pt`

therefore represents centuries of gradual standardisation.

Even the point itself was historically not a universal physical quantity. Competing systems existed before digital publishing effectively collapsed these traditions into a handful of computational conventions.

Typography became easier to specify as it became more abstract.

It also became easier to misunderstand.

# Hot metal and mechanical composition

By the late nineteenth and twentieth centuries, machines such as Linotype and Monotype mechanised substantial parts of composition.

Linotype famously cast an entire line of text as a metal slug. Monotype separated keyboarding from casting and produced individual characters.

This altered both the economics and rhythm of document production. Newspapers, books and commercial printing could be composed at speeds impossible under hand composition.

Yet the page remained stubbornly physical.

Corrections cost time.

Late changes propagated through line endings and pagination.

Editors learnt to think about space because space had industrial consequences.

A paragraph that ran three lines longer might push another story onto a different page. A headline was not simply text with a CSS class; it was a geometric object that had to occupy a predetermined hole.

::: {.pullquote size=large attribution="Production principle"}
Every publishing technology eventually turns language into geometry.
:::

# The tyranny of the line ending

Line breaking deserves particular attention because it exposes how strongly a font participates in document structure.

Change the font and you change glyph widths.

Change glyph widths and you change line endings.

Change line endings and you change paragraph heights.

Change paragraph heights and you change page breaks.

Change page breaks and suddenly:

* a heading is stranded at the foot of a page;
* a footnote moves;
* a table splits;
* a cross-reference points to the wrong page;
* an index entry becomes inaccurate;
* the document acquires another page.

A missing font is therefore not merely a cosmetic problem.

It can be a structural problem.

This is why font substitution is particularly dangerous in automated document pipelines. A fallback font can produce text that appears entirely reasonable while silently altering the pagination of the entire document.

# Proofs, corrections and authority

The history of publishing is also a history of proofs.

A proof occupies an interesting position between source and final object. It is a rendering produced so that mistakes in the source, composition or production process can be discovered before multiplication makes them expensive.

The PDF preview produced by this system plays much the same role.

We render.

We inspect.

We correct.

We render again.

The technology has changed considerably. The loop has not.

Traditional proofreaders developed a sophisticated vocabulary of marks for deletions, insertions, transpositions, damaged type, incorrect fonts and spacing. Modern software replaces much of this with tracked changes, comments, preflight reports and automated tests.

A font smoke test is, in that sense, simply another proofreader's mark expressed as software.

# Stereotypes, plates and reproducibility

Printers eventually developed ways of preserving composed pages without keeping thousands of pieces of movable type locked indefinitely in formes.

Stereotyping produced a mould from a composed page and then cast a durable printing plate from it.

The principle is strikingly modern.

There is a costly or complicated source representation. From it, a more portable artefact is created. That artefact can then reproduce the intended result without reconstructing the original environment.

A modern PDF with embedded fonts serves a surprisingly similar purpose.

The goal is not to recreate the designer's workstation.

The goal is to preserve enough of the page's production state that someone else can reproduce its appearance.

# Phototypesetting: type becomes light

Phototypesetting broke the centuries-old connection between type and metal.

Characters could now be projected photographically onto film or photosensitive paper. Type became an optical image rather than a physical printing surface.

This produced enormous changes in typographic practice.

Scaling became easier.

Spacing could become tighter.

Characters could overlap.

The relationship between the nominal size of type and any particular piece of metal disappeared.

Typography started its transition from manufacturing to information processing.

But phototypesetting systems introduced their own dependencies: proprietary machines, font masters, encoding schemes and output processes.

The question remained the same:

**Can the next stage of the production chain correctly interpret what the previous stage intended?**

# Paste-up and the invisible ancestry of the digital page

For a period, document production often involved an unexpectedly literal version of “layout”.

Typeset text was output onto photographic paper, cut into pieces and physically pasted onto boards alongside photographs, rules and other graphic elements.

Camera-ready artwork was then photographed for plate production.

Many conventions of desktop publishing software make more intuitive sense when seen against this background.

A page is a surface.

Objects are placed upon it.

Frames contain text.

Images occupy boxes.

Elements sit in front of or behind one another.

Things are aligned, cropped and moved.

The digital layout application did not invent this conceptual model. It virtualised the paste-up table.

# PostScript: the page becomes a program

One of the decisive developments in digital publishing was PostScript.

Instead of describing a page as a bitmap, PostScript described how the page should be constructed: draw this shape, place this glyph, transform this coordinate system, fill this region.

The page had become a program.

This was extraordinarily powerful because the same description could be rendered at different resolutions by different output devices.

A laser printer and a high-resolution imagesetter could execute the same page description and produce output appropriate to their capabilities.

That separation between description and rendering is foundational to modern document systems.

It is also where many familiar production failures emerge.

If the rendering environment lacks something assumed by the page description — most notoriously a font — the resulting page may diverge from the author's intent.

# The font problem

Early desktop publishing workflows routinely depended on fonts installed separately on the originating computer, the prepress bureau and the final output device.

Anyone who has opened an old document and been greeted by a substitution warning has encountered this architectural problem directly.

The document says, in effect:

> Please render this using a thing that I assume you already possess.

That assumption works until the file crosses a boundary.

Another computer.

Another operating system.

Another bureau.

Another decade.

Another container image.

Another CI runner.

The history of reliable digital publishing is therefore partly the history of eliminating environmental assumptions.

# TrueType, Type 1 and OpenType

Digital font formats gradually became more sophisticated and interoperable.

Adobe Type 1 fonts were deeply associated with the PostScript publishing ecosystem. TrueType, developed by Apple and licensed to Microsoft, provided another outline-font architecture and sophisticated hinting capabilities.

OpenType later provided a common container capable of holding different outline technologies while supporting richer typographic behaviour.

Modern OpenType fonts can contain far more than outlines.

They may include information about:

* kerning;
* ligatures;
* alternate glyphs;
* small capitals;
* oldstyle numerals;
* tabular numerals;
* fractions;
* language-specific substitutions;
* mark positioning;
* script shaping;
* variable design axes.

The “font” has become a small typographic program.

# PDF and the portable page

PDF represented another major step in the effort to make documents independent of the environments that created them.

Its central promise was contained in its name: *Portable Document Format*.

A correctly constructed PDF could carry with it the resources necessary to reproduce the intended page, including embedded font programs or subsets of those programs.

This does not mean PDFs are magically immutable.

Transparency, colour management, font encoding, overprinting, annotations, forms, version differences and renderer behaviour can still produce surprises.

But PDF moves the document much closer to being a self-contained production artefact.

That is why font embedding matters so much here.

A PDF that references an unavailable font has abandoned part of the portability contract.

# Font subsetting

Embedding does not always mean placing the complete font file inside the document.

PDF generators commonly subset fonts, embedding only the glyphs needed by the document.

A document containing:

**DOCUMENT 2026**

does not necessarily need the font's Armenian characters, mathematical operators and hundreds of unused accented glyphs.

Subsetting reduces file size and can simplify distribution.

It also makes smoke tests worth designing carefully.

If you want to verify that a glyph can be embedded and rendered, that glyph must actually occur in the test document.

Hence the slightly artificial character sequences scattered through this page.

# Variable fonts: many faces in one program

Variable fonts return, in an unexpected way, to the idea that a typeface can exist as a design space rather than a collection of isolated static instances.

Instead of separate files for Regular, Medium, Semibold and Bold, a single font can describe interpolation across a weight axis.

Other axes may control:

* width;
* optical size;
* slant;
* grade;
* or parameters unique to a particular design.

Source Serif 4 is useful here because it allows us to test whether the production pipeline correctly handles modern font technology rather than merely locating a conventional static face.

**Regular.**

**Medium-ish.**

**Bold.**

The underlying question is whether the renderer receives and honours the intended coordinates in the design space.

# Roman and italic are companions, not transformations

This paragraph deliberately alternates between roman and italic text.

Roman establishes the principal reading texture. *Italic introduces another rhythm entirely.* Its narrower forms, entry strokes and altered letter construction create contrast without requiring substantially heavier colour on the page.

A renderer that synthesises italic by simply skewing roman glyphs may satisfy the CSS instruction technically while failing typographically.

Consider:

*minimum, affinity, graceful, typography, organisation, difficult.*

The repeated ascenders, descenders and joins make the distinction easier to see.

A useful smoke test should therefore test not merely whether something is slanted, but whether the intended italic font resource was actually used.

# Ligatures and shaping

Typography is not necessarily a one-character-in, one-glyph-out process.

Consider:

**office affinity difficult efficient final**

Sequences such as `fi` and `ffi` may be represented using ligature glyphs depending on font features and shaping behaviour.

This reflects another important development in document production: increasingly, the intelligence that was once held by the compositor is encoded in software and font tables.

The shaping engine is now part of the typesetting staff.

For Latin text this can appear subtle.

For scripts such as Arabic, Devanagari and many others, shaping is fundamental to producing correct text at all.

# Numbers are typography too

Documents often reveal font problems more readily through numbers than prose.

0123456789

£1,234.56
$9,876.54
€3.141,59
37%
2024–2026
12:45
IV
MMXXVI

Financial reports may prefer tabular numerals so columns align vertically.

Running prose may use proportional numerals.

Historical or literary settings may use oldstyle figures that rise and descend like lowercase letters.

The visual behaviour of numbers is therefore not incidental. It forms part of the information design of the document.

::: {.keyfigure value="$12,345,678" label="Tabular-figure alignment and currency glyph test" trend=up}
Large financial values provide a useful test of commas, currency symbols, numerals, weight and spacing.
:::

# Punctuation carries surprising amounts of information

A reliable document pipeline should also preserve punctuation correctly:

“Double quotation marks.”

‘Single quotation marks.’

An en dash: 2024–2026.

An em dash: typography — when handled well — should disappear into reading.

An ellipsis: one thing… followed by another.

A prime: 6′ 2″.

A multiplication sign: 1920 × 1080.

A minus sign: −42.

A hyphen-minus: -42.

These characters are not interchangeable merely because some of them look similar.

Document production systems have spent decades cleaning up the consequences of software that treated them as though they were.

# The typewriter detour

The typewriter introduced another influential document convention: monospaced text.

Every character occupied the same horizontal width.

`iiiiiiiiii`

`MMMMMMMMMM`

On a typewriter these strings consume identical space.

That mechanical constraint shaped practices that persisted long after the constraint disappeared, including the habit of placing two spaces after a full stop.

Proportional digital typography removes the original justification for that convention, but conventions often survive their technologies.

Document history is full of such ghosts.

# Word processors changed authorship

Desktop word processors collapsed roles that had often been separated.

The person writing the words could now also choose the typeface, margins, line spacing, heading sizes and page breaks.

This democratised document production.

It also meant millions of people became accidental typographers.

The results ranged from excellent to spectacular.

The availability of forty fonts did not necessarily improve a memo.

The ability to centre text did not mean it should be centred.

The ability to manually insert page breaks created documents whose layout depended on a fragile chain of assumptions about fonts, printers and software versions.

WYSIWYG — *what you see is what you get* — was revolutionary.

It also raised a new question:

**What happens when somebody else sees something different?**

# Styles, structure and the return of abstraction

Well-designed modern publishing systems separate semantic structure from visual appearance.

A heading is identified as a heading.

A quotation is identified as a quotation.

A key figure is identified as a key figure.

The renderer decides how those structures should appear.

This approach has deep advantages.

The same source can potentially produce:

* a web page;
* a print PDF;
* an accessible document;
* an e-book;
* a presentation;
* a plain-text representation.

The author specifies meaning.

The production system specifies appearance.

In that respect, structured authoring partially reverses the word-processor model, where writers directly manipulate the appearance of the page.

# HTML and CSS enter the printing room

The web was initially conceived principally as a screen medium, but HTML and CSS have evolved into surprisingly capable document-production technologies.

Modern paged-media pipelines can use familiar web constructs to produce sophisticated print layouts.

The underlying stack may include:

1. structured source;
2. Markdown or another authoring syntax;
3. an intermediate document tree;
4. HTML;
5. CSS;
6. a browser or paged-media engine;
7. a PDF backend;
8. embedded font resources.

Each stage translates intent.

Every translation creates the possibility of divergence.

The advantage is that the entire chain can now be automated.

The disadvantage is that the entire chain can now fail automatically too.

# Containers and reproducible publishing

Containerised document rendering represents a logical extension of the reproducible-build movement in software engineering.

Instead of saying:

> Install these tools and these fonts and hopefully your machine behaves like mine.

we attempt to specify the complete rendering environment.

The renderer version.

The system libraries.

The fonts.

The CSS.

The source document.

The conversion command.

The environment itself becomes part of the publication.

This is important because documents often have longer lives than the systems that create them.

A rendering pipeline that works on one developer's laptop today is not yet a production system.

A rendering pipeline that can be reconstructed predictably on another machine is much closer.

# Why fallback fonts are dangerous

Font fallback is useful on the web because showing readable text is normally better than showing nothing.

In deterministic document production, however, silent fallback can be dangerous.

Imagine a board paper whose final line on page 17 moves to page 18 because the substitute font is fractionally wider.

That may move a table.

The table may move a heading.

The heading may create another page.

The contents page may change.

The PDF is still perfectly readable.

Nothing has obviously crashed.

Yet the artefact is not the artefact that was approved.

A good production system should therefore treat unexpected font substitution less like graceful degradation and more like a failed build.

::: {.callout kind=warning title="Silent substitution is a production error"}
A renderer producing *some* readable glyphs is not sufficient. For controlled document output, the test is whether the intended glyphs were produced from the intended font resources.
:::

# Reproducibility is a spectrum

Even with fonts correctly embedded, bit-for-bit identical rendering can be surprisingly difficult.

Differences may arise from:

* rendering engine versions;
* font revisions;
* shaping-library versions;
* floating-point behaviour;
* image codecs;
* operating-system libraries;
* colour profiles;
* metadata timestamps;
* font subsetting order;
* compression behaviour.

It is therefore useful to distinguish several levels of reproducibility.

**Semantic reproducibility**
The words, numbers and document structure remain the same.

**Typographic reproducibility**
The fonts, line endings and page geometry remain the same.

**Visual reproducibility**
Rendered pages appear indistinguishable to a reader.

**Binary reproducibility**
The output files are byte-for-byte identical.

Different production systems require different guarantees.

A legal filing may demand extremely strong visual stability.

A draft briefing may tolerate minor rasterisation differences.

A reproducible-build system may seek binary equality.

The requirement should be explicit.

# The page is still an interface

It is tempting to think of printed documents as static things and digital applications as interfaces.

But a document has always been an interface between a writer and a reader.

Typography communicates hierarchy.

Margins communicate pacing.

Headings provide navigation.

Tables compress comparison.

Footnotes allow digression without destroying the main argument.

Running heads provide orientation.

Page numbers create addresses.

Indexes create retrieval systems.

Even the humble paragraph is a user-interface component refined over centuries.

Document engineering is therefore not merely about putting words onto pages.

It is interface engineering with an unusually long history.

# A small gallery of stress cases

## Capitals

ABCDEFGHIJKLMNOPQRSTUVWXYZ

THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG.

Watch **M**, **W**, **R**, **G**, **Q** and the overall width of the line.

## Lowercase

abcdefghijklmnopqrstuvwxyz

the quick brown fox jumps over the lazy dog.

Watch `a`, `e`, `g`, `r`, `s` and the x-height.

## Numerals

0123456789
0000000000
1111111111
1234567890
1,000,000.00
£999,999.99

## Punctuation

.,:;!?
() [] {}
“ ” ‘ ’

* – —
  / \ |
  @ # % & *
  … © ® ™

## Difficult pairs

AV AW AY
Ta Te To Ty
Wa We Wo
Yo Ya
ff fi fl ffi ffl
rn m
cl d

Kerning errors are often easier to detect in combinations than individual glyphs.

# A pangram survives for a reason

::: {.pullquote size=large attribution="Weight axis check"}
Handgloves 0123456789 — the quick brown fox jumps over the lazy dog.
:::

The famous fox sentence is useful because it includes every letter of the English alphabet, but it is not sufficient by itself.

A production test should contain the kinds of things real documents contain:

**£24.5 million**, not merely `ABC`.

*Italics inside parentheses.*

**Bold text followed immediately by punctuation.**

“Quoted text with smart punctuation.”

A date such as **9 August 2026**.

A reference such as **§ 588G(2)(b)(iii)**.

A ratio such as **3:2**.

A range such as **18–24 months**.

A filename such as `annual-report-v17-final-FINAL-2.pdf`.

These are the places where encoding, shaping and substitution errors tend to become conspicuous.

# From compositor to pipeline

The people responsible for making documents have changed names repeatedly.

Scribe.

Printer.

Compositor.

Typesetter.

Paste-up artist.

Prepress operator.

Graphic designer.

Desktop publisher.

Front-end developer.

Document engineer.

The underlying responsibility is remarkably stable.

Take an author's abstract intentions and turn them into a reliable physical or digital artefact.

The tools become more automated, but automation does not eliminate craft. It relocates it.

A compositor once worried about loose lines and bad spacing.

A modern document engineer worries about CSS fragmentation, font discovery, container images, browser versions and PDF conformance.

Both are debugging pages.

# The paradox of modern publishing

Producing a page has never been easier.

Producing exactly the same page everywhere remains surprisingly difficult.

We now possess typographic capabilities that would have been astonishing to earlier printers:

* thousands of fonts;
* arbitrary scaling;
* complex scripts;
* transparency;
* vector graphics;
* automated cross-references;
* live data;
* programmatic charts;
* instant pagination;
* unlimited corrections;
* automated production.

Yet an absent `.woff2` file can still cause an entire document to reflow.

The machinery changed.

The production problem survived.

# Why this smoke test exists

This page therefore tests more than whether the sentence “Hello world” appears.

It tests whether the rendering environment can faithfully reconstruct a particular typographic system.

Specifically:

* Source Serif 4 should render body text;
* Source Serif 4 Italic should provide true italic forms;
* the weight axis should produce intentional heavier text;
* Inter should render headings and display figures;
* numerals and punctuation should resolve correctly;
* ligatures and shaping should remain sane;
* line metrics should remain stable;
* no generic fallback family should silently alter pagination.

If those conditions hold, the document is not merely readable.

It is reproducible.

::: {.callout kind=success title="Successful render"}
If the serif text, italic forms, Inter headings, tabular figures and large key figures all look intentional — and repeated renders preserve the same line and page breaks — the font layer is behaving as part of a deterministic document-production system.
:::

# Closing observation

For six centuries, document technology has repeatedly promised to separate the author's intention from the accidents of production.

Movable type separated the text from the scribe.

Stereotyping separated the print run from the standing type.

Phototypesetting separated letterforms from metal.

PostScript separated page description from output resolution.

PDF separated distribution from the originating application.

Font embedding separated the document from the fonts installed on the recipient's machine.

Containers now attempt to separate the rendering process from the developer's machine itself.

Each advance pushes a little more production state into the artefact or its reproducible environment.

And that is ultimately what this smoke test is checking.

Not simply:

**Did the PDF render?**

But:

**Did this machine produce the page we meant?**

I’ve deliberately made it useful as both **interesting filler copy and an actual rendering diagnostic** — especially around italics, ligatures, numerals, punctuation, kerning pairs, fallback behaviour and pagination.
