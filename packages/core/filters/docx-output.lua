-- docx-output.lua
-- Post-processes vocabulary.lua HTML output into native DOCX-compatible AST.
-- Only active when FORMAT == "docx".
--
-- vocabulary.lua emits all primitives as RawBlock('html', ...) elements.
-- When pandoc writes DOCX these raw HTML blocks are silently dropped, so the
-- exported file loses every callout, keyfigure, KPI grid, allocation table,
-- recommendation, etc.
--
-- This companion filter runs AFTER vocabulary.lua in the pipeline and converts
-- those HTML blocks back to native pandoc AST via pandoc's own HTML reader.
-- Since we control the exact HTML patterns vocabulary.lua emits, this round-
-- trip is reliable: the HTML reader understands <aside>, <div>, <table>,
-- <figure>, <p>, headings, etc. and converts them to equivalent pandoc blocks
-- (Para, Table, Header, Div, …) which pandoc's DOCX writer handles natively.
--
-- Wiring: pass AFTER vocabulary.lua and microtype.lua in the pandoc command:
--   pandoc … --lua-filter vocabulary.lua \
--            --lua-filter microtype.lua  \
--            --lua-filter docx-output.lua
--
-- This filter is a no-op for every format except docx.

if FORMAT ~= "docx" then return {} end

-- ---------------------------------------------------------------------------
-- html_to_blocks: parse an HTML string into pandoc blocks via the HTML reader.
-- Returns a (possibly empty) list of pandoc Block elements.
-- On any error returns a single Para containing the raw HTML as a code span so
-- content is never silently lost.
-- ---------------------------------------------------------------------------
local function html_to_blocks(html)
  local ok, result = pcall(pandoc.read, html, 'html')
  if not ok or not result then
    -- Fallback: render as a monospace paragraph so content is visible.
    return { pandoc.Para({ pandoc.Code(html) }) }
  end
  return result.blocks
end

-- ---------------------------------------------------------------------------
-- is_structural_wrapper: returns true for bare open/close div/aside/figure
-- tags that carry no textual content (e.g. "<div>" or "</aside>").
-- vocabulary.lua sometimes emits multi-part HTML across adjacent RawBlocks —
-- the content-bearing block is the one with real text; empty wrappers can be
-- discarded safely.
-- ---------------------------------------------------------------------------
local function is_structural_wrapper(text)
  -- Trim whitespace.
  local t = text:match('^%s*(.-)%s*$')
  -- Matches a single self-contained open or close tag with no inner content:
  --   <div ...>  </div>  <aside>  </figure>  etc.
  -- Heuristic: tag text has no '<' after the first '>' (i.e. nothing between
  -- the opening/closing angle brackets beyond optional attrs).
  if t:match('^</?%a[%w%-]*[^>]*>%s*$') then
    return true
  end
  return false
end

-- ---------------------------------------------------------------------------
-- RawBlock handler: the main entry point for this filter.
-- Called for every RawBlock in the pandoc AST after vocabulary.lua has run.
-- ---------------------------------------------------------------------------
function RawBlock(el)
  -- Only handle HTML raw blocks.
  if el.format ~= 'html' then return el end

  -- Discard empty structural wrappers (bare open/close tags with no content).
  if is_structural_wrapper(el.text) then return {} end

  -- Convert to native pandoc blocks via the HTML reader.
  local blocks = html_to_blocks(el.text)

  -- Nothing came back — discard.
  if #blocks == 0 then return {} end

  -- Single block: unwrap (return the block directly so we don't nest needlessly).
  if #blocks == 1 then return blocks[1] end

  -- Multiple blocks: wrap in a Div so pandoc keeps them as a unit.
  -- The Div carries no classes/attrs so it is transparent in the DOCX output.
  return pandoc.Div(blocks)
end

-- ---------------------------------------------------------------------------
-- RawInline handler: vocabulary.lua may emit RawInline('html', ...) for inline
-- badges/labels. Convert those to plain Str so they appear in DOCX text runs.
-- ---------------------------------------------------------------------------
function RawInline(el)
  if el.format ~= 'html' then return el end
  -- Strip all HTML tags, leaving just the text content.
  local text = el.text:gsub('<[^>]+>', '')
  -- Decode common HTML entities.
  text = text:gsub('&amp;',  '&')
             :gsub('&lt;',   '<')
             :gsub('&gt;',   '>')
             :gsub('&quot;', '"')
             :gsub('&#39;',  "'")
             :gsub('&nbsp;', ' ')
  if text == '' then return {} end
  return pandoc.Str(text)
end
