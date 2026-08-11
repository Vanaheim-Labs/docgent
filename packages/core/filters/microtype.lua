-- DocForge microtypography filter.
--
-- Runs AFTER vocabulary.lua. Operates only on Str/Space inline runs in body
-- prose; it never rewrites code, math, links' URLs, or raw HTML, because those
-- are byte-significant. Everything here is a typesetting refinement that a
-- human typesetter would apply by hand.
--
-- Pandoc's +smart extension already handles quotes, em/en dashes and ellipses.
-- This filter covers what smart does not: non-breaking spaces around units and
-- references, thin spaces in numbers, and the tie between a value and its
-- symbol. Widow/orphan and hanging-punctuation control is CSS, not here.

local NBSP = '\u{00A0}'   -- non-breaking space
local NNBSP = '\u{202F}'  -- narrow no-break space
local THIN = '\u{2009}'   -- thin space

-- Blocks whose inline content must never be touched.
local OPAQUE = {
  CodeBlock = true, RawBlock = true, HorizontalRule = true,
}

-- Units that must never be orphaned from their number.
--
-- Deliberately excludes single ASCII letters ('m', 'k', 'x'). They are
-- ambiguous: 'm' is metres, millions, or the start of a word; 'x' is a
-- multiplier or a variable. Tying them welds unrelated words together
-- ("20 x once" became "20\u{202F}x once" in testing). Authors who mean a
-- unit should write it closed up ("$4.2m", "20x"), which needs no tie
-- because it is already a single token.
--
-- '×' (U+00D7) is kept: it is unambiguously a multiplication sign.
local UNITS = {
  'bn', '×',
  'kg', 'km', 'cm', 'mm', 'ha',
  'pt', 'px', 'mb', 'gb', 'tb',
  'hrs', 'hr', 'yr', 'yrs', 'pa',
}

local UNIT_SET = {}
for _, u in ipairs(UNITS) do UNIT_SET[u:lower()] = true end

-- Words that should stay glued to the number that follows them.
-- 'Figure 4' breaking across a line is a classic amateur tell.
local REF_WORDS = {
  figure = true, fig = true, table = true, section = true,
  chapter = true, appendix = true, exhibit = true, page = true,
  clause = true, part = true, note = true, step = true,
  phase = true, tier = true, stage = true, item = true,
  volume = true, version = true, ['no.'] = true,
}

local function is_digit_start(s)
  return s ~= nil and s:match('^%d') ~= nil
end

-- Does this string end in a bare number (optionally with separators)?
local function ends_in_number(s)
  return s ~= nil and s:match('[%d][%d,%.]*$') ~= nil
end

-- Strip trailing punctuation so 'Figure' and 'Figure,' both classify.
local function bare_word(s)
  return (s:gsub('[%p]+$', '')):lower()
end

-- Currency and maths symbols that bind to the following number.
local function is_currency(s)
  return s:match('^[%$£€¥]$') ~= nil
end

--- Walks an inline list, replacing Space with a non-breaking equivalent
--- wherever a line break would read as a typesetting error.
local function tie_inlines(inlines)
  local out = pandoc.List()
  local i = 1
  local n = #inlines

  while i <= n do
    local cur = inlines[i]
    local nxt = inlines[i + 1]
    local after = inlines[i + 2]

    -- Pattern: <Str><Space><Str> where the gap must not break.
    if cur.t == 'Str' and nxt and nxt.t == 'Space' and after and after.t == 'Str' then
      local left = cur.text
      local right = after.text
      local tie = nil

      -- 1. Number followed by a unit:  "2.4 bn", "20 ×", "500 km"
      if ends_in_number(left) and UNIT_SET[bare_word(right)] then
        tie = NNBSP

      -- 2. Reference word followed by its number:  "Figure 4", "Section 3.2"
      elseif REF_WORDS[bare_word(left)] and is_digit_start(right) then
        tie = NBSP

      -- 3. Currency symbol standing alone before a number:  "$ 4.2m"
      elseif is_currency(left) and is_digit_start(right) then
        tie = ''

      -- 4. Percent sign split from its number:  "18 %"
      elseif ends_in_number(left) and right:match('^%%') then
        tie = NNBSP
      end

      if tie ~= nil then
        out:insert(cur)
        if tie ~= '' then out:insert(pandoc.Str(tie)) end
        out:insert(after)
        i = i + 3
        goto continue
      end
    end

    out:insert(cur)
    i = i + 1
    ::continue::
  end

  return out
end

--- Digit grouping inside a single Str: 1000000 -> 1 000 000 is NOT done,
--- because changing an author's number formatting is a content decision.
--- What IS safe is preventing a break inside an already-grouped number
--- such as "1,250,000" — those never break in Lua-produced Str anyway.
--- So this filter deliberately does nothing there.

-- Apply to prose-bearing blocks only.
function Para(el)
  el.content = tie_inlines(el.content)
  return el
end

function Plain(el)
  el.content = tie_inlines(el.content)
  return el
end

function Header(el)
  el.content = tie_inlines(el.content)
  return el
end

function Caption(el)
  if el.long then
    for _, b in ipairs(el.long) do
      if b.t == 'Para' or b.t == 'Plain' then
        b.content = tie_inlines(b.content)
      end
    end
  end
  return el
end

-- Table cells carry figures; ties matter most there.
function Cell(el)
  for _, b in ipairs(el.contents) do
    if b.t == 'Para' or b.t == 'Plain' then
      b.content = tie_inlines(b.content)
    end
  end
  return el
end
