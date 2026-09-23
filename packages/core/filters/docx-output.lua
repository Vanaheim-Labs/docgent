-- docx-output.lua  (complete rewrite — high-fidelity OpenXML)
-- Converts Docgent vocabulary HTML primitives to targeted OpenXML for DOCX export.
-- Falls back to pandoc HTML reader for primitives not explicitly handled.
--
-- Architecture: Pandoc(doc) document-level filter accumulates consecutive
-- RawBlock('html', ...) emitted by vocabulary.lua into logical units, then
-- dispatches to per-primitive handlers that produce native OpenXML.
--
-- Pipeline: vocabulary.lua → microtype.lua → docx-output.lua

if FORMAT ~= "docx" then return {} end

-- ============================================================
-- SVG guards — two layers:
--
-- 1. Image() filter: catches pandoc Image AST elements whose src
--    is an .svg path or data:image/svg URI.  These arise when the
--    HTML reader parses an <img src="..."> inside a RawBlock.
--    rsvg-convert is installed on the render worker (2.54.7) but
--    large SVGs (>200 KB) hang it on aarch64 Linux; replacing them
--    with a placeholder is safer than size-gating here.
--
-- 2. RawBlock() filter: catches inline <svg>...</svg> XML bodies
--    that vocabulary.lua places inside RawBlock('html', ...) when
--    _inline_svg_figures() inlines SVG file content directly.
--    These never become pandoc Image elements so Image() misses
--    them; pandoc tries to embed them via rsvg-convert and hangs.
--
-- Both guards emit a bordered OpenXML paragraph placeholder.
-- ============================================================

local function _svg_placeholder(label)
  local function esc(s)
    return (s or ''):gsub('&','&amp;'):gsub('<','&lt;'):gsub('>','&gt;'):gsub('"','&quot;')
  end
  return pandoc.RawBlock('openxml', string.format(
    '<w:p><w:pPr><w:jc w:val="center"/>'
    ..'<w:spacing w:before="120" w:after="120"/>'
    ..'<w:pBdr>'
    ..'<w:top    w:val="single" w:sz="4" w:space="2" w:color="AAAAAA"/>'
    ..'<w:bottom w:val="single" w:sz="4" w:space="2" w:color="AAAAAA"/>'
    ..'</w:pBdr></w:pPr>'
    ..'<w:r><w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="888888"/></w:rPr>'
    ..'<w:t xml:space="preserve">[ Figure: %s ]</w:t></w:r></w:p>',
    esc(label)
  ))
end

function Image(el)
  local src = el.src or ''
  local is_svg = src:match('%.svg$') or src:match('^data:image/svg')
  if not is_svg then return el end
  local alt = pandoc.utils.stringify(el.caption or el.alt or {})
  if alt == '' then alt = src:match('[^/]+%.svg$') or 'SVG figure' end
  return _svg_placeholder(alt)
end

-- RawBlock guard: strip inline <svg> bodies from HTML RawBlocks.
-- When server.py's _inline_svg_figures() inlines an SVG file's content
-- directly into the fenced-div body, vocabulary.lua wraps it in a
-- <figure class="figure chart">...<svg>...</svg>...</figure> RawBlock.
-- Pandoc's DOCX writer calls rsvg-convert on any embedded SVG XML,
-- which hangs indefinitely on large files (>200 KB) on aarch64 Linux.
-- This filter replaces any RawBlock whose text contains a bare <svg>
-- opening tag with a placeholder — the docx_safe=True flag in server.py
-- already handles the common case, but this is a belt-and-suspenders guard.
function RawBlock(el)
  if el.format ~= 'html' then return el end
  -- Fast heuristic: look for a top-level <svg or <SVG tag in the block.
  -- Inline data:image/svg URIs inside attributes are fine (they're small);
  -- we target large SVG XML bodies that appear as direct block content.
  -- Match <svg at the start of a line or after whitespace, not inside quotes.
  local text = el.text or ''
  -- Check for bare <svg tag as block content (not inside an attribute value).
  -- An inline SVG body always starts with <svg at the top of the block or
  -- shortly after the wrapping <figure> tag.
  if text:match('[\n\r%s]<svg[%s>]') or text:match('^<svg[%s>]') then
    -- Extract a useful label from the surrounding figure caption if present.
    local caption = text:match('class="figure%-caption">(.-)</figcaption>')
                 or text:match('class="chart%-title">(.-)</div>')
                 or text:match('class="chart%-label">(.-)</div>')
                 or 'SVG figure'
    -- Strip any remaining HTML tags from the caption.
    caption = caption:gsub('<[^>]+>', ''):gsub('^%s*(.-)%s*$', '%1')
    return _svg_placeholder(caption)
  end
  return el
end

-- ============================================================
-- Helpers
-- ============================================================

local function xml_esc(s)
  if not s then return '' end
  return s:gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'):gsub('"', '&quot;')
end

local function strip_tags(s)
  if not s then return '' end
  return (s:gsub('<[^>]+>', '')
           :gsub('&amp;',  '&')
           :gsub('&lt;',   '<')
           :gsub('&gt;',   '>')
           :gsub('&quot;', '"')
           :gsub('&#39;',  "'")
           :gsub('&nbsp;', ' ')
           :match('^%s*(.-)%s*$'))
end

-- Read/parse a number from a percentage string ("40%" → 40).
local function pct_num(s)
  if not s then return 0 end
  return tonumber(s:match('(%d+)')) or 0
end

-- ============================================================
-- OpenXML primitives
-- ============================================================

-- Paragraph with sized/optional-bold text.
-- sz is half-points (36pt = 72).
local function styled_para(text, sz, bold, color, caps, spacing_after)
  local b   = bold  and '<w:b/>'   or ''
  local c   = caps  and '<w:caps/>' or ''
  local col = color and ('<w:color w:val="' .. color .. '"/>') or ''
  local sp  = spacing_after and
              ('<w:pPr><w:spacing w:after="' .. spacing_after .. '"/></w:pPr>') or
              '<w:pPr><w:spacing w:after="0"/></w:pPr>'
  return pandoc.RawBlock('openxml', string.format(
    '<w:p>%s<w:r><w:rPr>%s%s%s<w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
    sp, b, c, col, sz, sz, xml_esc(text)
  ))
end

-- Convenience alias used by spec (big_para retained for clarity).
local function big_para(text, sz, bold)
  return styled_para(text, sz, bold, nil, nil, '0')
end

-- Empty paragraph (spacer).
local function empty_para()
  return pandoc.RawBlock('openxml', '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>')
end

-- Horizontal rule.
local function horiz_rule()
  return pandoc.RawBlock('openxml', [[
<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="CCCCCC"/></w:pBdr><w:spacing w:after="0"/></w:pPr></w:p>]])
end

-- Borderless table.
-- col_widths: list of twip strings.
-- rows: list of lists of raw XML cell-content strings (no <w:tc> wrapper).
local function borderless_table(col_widths, rows)
  local parts = {
    '<w:tbl>',
    [[<w:tblPr>
  <w:tblStyle w:val="TableGrid"/>
  <w:tblW w:w="0" w:type="auto"/>
  <w:tblBorders>
    <w:top    w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:left   w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:right  w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  </w:tblBorders>
  <w:tblLook w:val="0000"/>
</w:tblPr>]],
    '<w:tblGrid>',
  }
  for _, w in ipairs(col_widths) do
    parts[#parts+1] = '<w:gridCol w:w="' .. w .. '"/>'
  end
  parts[#parts+1] = '</w:tblGrid>'

  for _, row in ipairs(rows) do
    parts[#parts+1] = '<w:tr>'
    for ci, cell_xml in ipairs(row) do
      local w_val = col_widths[ci] or '1700'
      parts[#parts+1] = '<w:tc><w:tcPr><w:tcW w:w="' .. w_val .. '" w:type="dxa"/></w:tcPr>' .. cell_xml .. '</w:tc>'
    end
    parts[#parts+1] = '</w:tr>'
  end
  parts[#parts+1] = '</w:tbl>'
  return pandoc.RawBlock('openxml', table.concat(parts, '\n'))
end

-- Bordered single-cell table (for callouts).
local function bordered_box(fill_color, content_xml)
  return pandoc.RawBlock('openxml', string.format([[
<w:tbl>
<w:tblPr>
  <w:tblStyle w:val="TableGrid"/>
  <w:tblW w:w="0" w:type="auto"/>
  <w:tblBorders>
    <w:top    w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
    <w:left   w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
    <w:right  w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>
    <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  </w:tblBorders>
  <w:tblLook w:val="0000"/>
</w:tblPr>
<w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>
<w:tr><w:tc>
  <w:tcPr>
    <w:tcW w:w="9000" w:type="dxa"/>
    <w:shd w:val="clear" w:color="auto" w:fill="%s"/>
  </w:tcPr>
  %s
</w:tc></w:tr>
</w:tbl>]], fill_color, content_xml))
end

-- Convert arbitrary HTML to pandoc blocks via reader (fallback).
local function generic_html_to_blocks(html)
  local ok, result = pcall(pandoc.read, html, 'html')
  if not ok or not result then
    return { pandoc.Para({ pandoc.Code(html) }) }
  end
  return result.blocks
end

-- ============================================================
-- Primitive handlers
-- ============================================================

-- ----- KPI grid -----
local function handle_kpi(html)
  -- Extract all kpi-card divs. Use a non-greedy but bounded pattern.
  local cards = {}
  -- Match each card up to its own closing </div> (newline-anchored to prevent
  -- greedy cross-card matching). Each kpi-card's children are single-depth
  -- leaf divs so the card closes with the first \n</div> after them.
  for card in html:gmatch('<div class="kpi%-card[^>]*>(.-)'..string.char(10)..'</div>') do
    cards[#cards+1] = card
  end
  -- Fallback: simpler pattern if no newlines.
  if #cards == 0 then
    for card in html:gmatch('<div class="kpi%-card[^>]*>([^<]*<div[^>]*>[^<]*</div>[^<]*<div[^>]*>[^<]*</div>[^<]*)') do
      cards[#cards+1] = card
    end
  end

  if #cards == 0 then return generic_html_to_blocks(html) end

  -- Build one table row with one column per card.
  local n = #cards
  local col_w
  if n == 2 then col_w = '3400'
  elseif n == 3 then col_w = '2267'
  else col_w = '1700' end

  local col_widths = {}
  for _ = 1, n do col_widths[#col_widths+1] = col_w end

  local cells = {}
  for _, card in ipairs(cards) do
    local label  = strip_tags(card:match('<div class="kpi%-label">([^<]*)</div>') or
                              card:match('<div class="kpi%-label">(.-)</div>') or '')
    local value  = strip_tags(card:match('<div class="kpi%-value">([^<]*)</div>') or '')
    local change = strip_tags(card:match('<div class="kpi%-change[^"]*">([^<]*)</div>') or '')

    local cell = ''
    -- Label: small, gray, caps
    cell = cell .. string.format(
      '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="888888"/><w:caps/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(label))
    -- Value: large bold
    cell = cell .. string.format(
      '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(value))
    -- Change (optional)
    if change ~= '' then
      cell = cell .. string.format(
        '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
        xml_esc(change))
    else
      cell = cell .. '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>'
    end

    cells[#cells+1] = cell
  end

  return { borderless_table(col_widths, { cells }) }
end

-- ----- Keyfigure -----
local function handle_keyfigure(html)
  local value = strip_tags(html:match('<div class="keyfigure%-value">(.-)</div>') or '')
  local label = strip_tags(html:match('<div class="keyfigure%-label">(.-)</div>') or '')
  local body  = html:match('<div class="keyfigure%-body">(.-)</div>')

  local blocks = {}
  if value ~= '' then
    blocks[#blocks+1] = big_para(value, 72, true)
  end
  if label ~= '' then
    blocks[#blocks+1] = big_para(label, 20, false)
  end
  if body and body ~= '' then
    for _, b in ipairs(generic_html_to_blocks('<p>' .. body .. '</p>')) do
      blocks[#blocks+1] = b
    end
  end
  return blocks
end

-- ----- Allocation / funds-row -----
local function handle_allocation(html)
  local rows = {}
  for row_html in html:gmatch('<div class="funds%-row">(.-)</div>%s*</div>') do
    local label = strip_tags(row_html:match('<div class="funds%-label">(.-)</div>') or '')
    local pct_s = strip_tags(row_html:match('<div class="funds%-pct">(.-)</div>') or '')
    -- Also try extracting from style width directly if funds-pct is missing.
    if pct_s == '' then
      pct_s = (row_html:match('width:(%d+)%%') or '') .. '%'
    end
    local pct = pct_num(pct_s)
    local bar = string.rep('\xe2\x96\x88', math.floor(pct / 5)) -- █ chars

    -- 3-column row: label | bar+pct | (right-align pct separately)
    local c1 = string.format(
      '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(label))
    local c2 = string.format(
      '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(bar))
    local c3 = string.format(
      '<w:p><w:pPr><w:spacing w:after="40"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
      xml_esc(pct_s))

    rows[#rows+1] = { c1, c2, c3 }
  end

  -- Fallback: simpler pattern without closing </div></div>
  if #rows == 0 then
    for label, pct_s in html:gmatch('<div class="funds%-label">([^<]*)</div>.-<div class="funds%-pct">([^<]*)</div>') do
      label = strip_tags(label)
      pct_s = strip_tags(pct_s)
      local pct = pct_num(pct_s)
      local bar = string.rep('\xe2\x96\x88', math.floor(pct / 5))
      local c1 = string.format(
        '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
        xml_esc(label))
      local c2 = string.format(
        '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="AAAAAA"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
        xml_esc(bar))
      local c3 = string.format(
        '<w:p><w:pPr><w:spacing w:after="40"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
        xml_esc(pct_s))
      rows[#rows+1] = { c1, c2, c3 }
    end
  end

  if #rows == 0 then return generic_html_to_blocks(html) end

  return { borderless_table({ '3000', '3000', '1000' }, rows) }
end

-- ----- Product cards -----
local function handle_product_cards(html)
  local cards = {}
  -- Newline-anchored to avoid greedy cross-card matching.
  for card in html:gmatch('<div class="prod">(.-)'..string.char(10)..'</div>') do
    cards[#cards+1] = card
  end
  if #cards == 0 then
    -- Fallback: prod-row divs are leaf nodes; grab card content up to </div>.
    for card in html:gmatch('<div class="prod">([^<]*<div[^>]*>[^<]*</div>[^<]*)') do
      cards[#cards+1] = card
    end
  end
  if #cards == 0 then return generic_html_to_blocks(html) end

  -- Build 2-column table; pair up cards.
  local pair_rows = {}
  local i = 1
  while i <= #cards do
    local function card_xml(card)
      local tag   = strip_tags(card:match('<div class="prod%-tag">(.-)</div>') or '')
      local title = strip_tags(card:match('<div class="prod%-title">(.-)</div>') or '')
      local sub   = strip_tags(card:match('<div class="prod%-sub">(.-)</div>') or '')
      local cell  = ''
      if tag ~= '' then
        cell = cell .. string.format(
          '<w:p><w:r><w:rPr><w:i/><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="888888"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
          xml_esc(tag))
      end
      if title ~= '' then
        cell = cell .. string.format(
          '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
          xml_esc(title))
      end
      if sub ~= '' then
        cell = cell .. string.format(
          '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
          xml_esc(sub))
      end
      for row_text in card:gmatch('<div class="prod%-row">([^<]*)</div>') do
        if strip_tags(row_text) ~= '' then
          cell = cell .. string.format(
            '<w:p><w:r><w:t xml:space="preserve">\xe2\x80\x94 %s</w:t></w:r></w:p>',
            xml_esc(strip_tags(row_text)))
        end
      end
      return cell
    end

    local c1 = card_xml(cards[i])
    local c2 = (i+1 <= #cards) and card_xml(cards[i+1]) or
               '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>'
    pair_rows[#pair_rows+1] = { c1, c2 }
    i = i + 2
  end

  return { borderless_table({ '4500', '4500' }, pair_rows) }
end

-- ----- Callout -----
local KIND_LABEL = {
  note    = 'NOTE',
  info    = 'INFO',
  warning = 'WARNING',
  risk    = 'RISK',
  success = 'SUCCESS',
}
local KIND_ICON = {
  note    = 'ℹ',
  info    = '💡',
  warning = '⚠',
  risk    = '🔴',
  success = '✅',
}

local function handle_callout(html)
  local kind  = html:match('data%-kind="([^"]*)"') or 'note'
  local title = strip_tags(html:match('<div class="callout%-title">(.-)</div>') or '')

  local icon  = KIND_ICON[kind]  or KIND_ICON.note
  local lbl   = KIND_LABEL[kind] or 'NOTE'
  local header_text = icon .. ' ' .. lbl .. (title ~= '' and (': ' .. title) or '')

  local header_xml = string.format(
    '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
    xml_esc(header_text))

  -- Extract body: everything after the callout-title div (or the whole block).
  local body_html = html:match('<div class="callout%-title">[^<]*</div>(.*)</aside>') or
                    html:match('<aside[^>]*>(.*)</aside>') or ''
  -- Strip the callout-title portion if it wasn't already consumed.
  body_html = body_html:gsub('<div class="callout%-title">[^<]*</div>', '')

  -- Convert body blocks to plain-text paragraphs inside the box.
  -- (pandoc.write in Lua filters cannot target OpenXML directly;
  --  we stringify body content and wrap in simple <w:p> elements.)
  local body_xml = ''
  local body_blocks = generic_html_to_blocks(body_html)
  for _, blk in ipairs(body_blocks) do
    local txt = pandoc.utils.stringify(blk)
    if txt ~= '' then
      body_xml = body_xml .. string.format(
        '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
        xml_esc(txt))
    end
  end

  return { bordered_box('F5F5F5', header_xml .. body_xml) }
end

-- ----- Recommendation -----
local function handle_recommendation(html)
  local ref      = strip_tags(html:match('<span class="recommendation%-ref">(.-)</span>') or '')
  local priority = strip_tags(html:match('<span class="recommendation%-priority">(.-)</span>') or '')
  local owner    = strip_tags(html:match('<span class="recommendation%-owner">(.-)</span>') or '')

  local head_parts = {}
  if ref      ~= '' then head_parts[#head_parts+1] = '[' .. ref .. ']' end
  if priority ~= '' then head_parts[#head_parts+1] = priority:upper() end
  if owner    ~= '' then head_parts[#head_parts+1] = owner end
  local head_text = table.concat(head_parts, ' \xe2\x80\x94 ')

  local body_html = html:match('</div>%s*(.-)%s*</div>%s*$') or ''
  body_html = body_html:gsub('<div class="recommendation%-head">[^>]*>.-</div>', '')

  local blocks = {}
  if head_text ~= '' then
    blocks[#blocks+1] = styled_para(head_text, 20, true, nil, nil, '40')
  end
  for _, b in ipairs(generic_html_to_blocks(body_html)) do
    blocks[#blocks+1] = b
  end
  blocks[#blocks+1] = horiz_rule()
  return blocks
end

-- ----- Timeline -----
local function handle_timeline(html)
  local blocks = {}
  -- Match each timeline-event. The body content follows after timeline-title.
  for event_html in html:gmatch('<div class="timeline%-event">(.-)</div>%s*</div>') do
    local date  = strip_tags(event_html:match('<div class="timeline%-date">(.-)</div>') or '')
    local title = strip_tags(event_html:match('<div class="timeline%-title">(.-)</div>') or '')
    local head  = (date ~= '' and (date .. ' \xe2\x80\x94 ') or '') .. title

    if head ~= '' then
      blocks[#blocks+1] = styled_para(head, 20, true, nil, nil, '40')
    end

    -- Body: content after the title div.
    local body_html = event_html:match('<div class="timeline%-title">[^<]*</div>(.*)$') or ''
    for _, b in ipairs(generic_html_to_blocks(body_html)) do
      blocks[#blocks+1] = b
    end
  end

  if #blocks == 0 then return generic_html_to_blocks(html) end
  return blocks
end

-- ----- KPI row (horizontal stat panel, different from grid) -----
local function handle_kpi_row(html)
  -- Extract individual kpi spans: <span class="kpi-n">value</span><span class="kpi-l">label</span>
  local cards = {}
  for n_val, l_val in html:gmatch('<span class="kpi%-n">([^<]*)</span>%s*<span class="kpi%-l">([^<]*)</span>') do
    cards[#cards+1] = { value = strip_tags(n_val), label = strip_tags(l_val) }
  end
  if #cards == 0 then return generic_html_to_blocks(html) end

  local n = #cards
  local col_w = tostring(math.floor(6800 / n))
  local col_widths = {}
  for _ = 1, n do col_widths[#col_widths+1] = col_w end

  local cells = {}
  for _, card in ipairs(cards) do
    local cell = string.format(
      '<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
      xml_esc(card.value))
    cell = cell .. string.format(
      '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
      xml_esc(card.label))
    cells[#cells+1] = cell
  end

  return { borderless_table(col_widths, { cells }) }
end

-- ============================================================
-- Dispatch
-- ============================================================

-- dispatch_with_class: use eff_class (first class-bearing tag in the group)
-- rather than just the first class in the combined string. This ensures that
-- prod-grid / kpi-grid are detected even when the accumulator stripped their
-- bare open-tag wrappers.
local function dispatch_with_class(html, eff_class)
  local class = eff_class or html:match('class="([^"]+)"') or ''

  if class:find('kpi%-grid') or class:find('kpi%-card') then
    return handle_kpi(html)
  elseif class:find('kpi%-row') then
    return handle_kpi_row(html)
  elseif class:find('keyfigure') then
    return handle_keyfigure(html)
  elseif class:find('funds%-row') or class:find('allocation') then
    return handle_allocation(html)
  elseif class:find('prod%-grid') or class:find('prod%-tag') or class:find('prod%-title') then
    return handle_product_cards(html)
  elseif class:find('callout') or html:match('<aside class="callout"') then
    return handle_callout(html)
  elseif class:find('recommendation') then
    return handle_recommendation(html)
  elseif class:find('timeline') then
    return handle_timeline(html)
  else
    return generic_html_to_blocks(html)
  end
end

-- ============================================================
-- Document-level filter: accumulate consecutive RawBlocks
-- ============================================================

-- Count net open-minus-close tag depth of an HTML text chunk.
local function net_depth(text)
  local opens  = 0
  local closes = 0
  -- Opening tags: <tagname or <tagname>
  for t in text:gmatch('<(%a[%w%-]*)') do
    if t then opens = opens + 1 end
  end
  -- Self-closing: /> — cancel one open each.
  for _ in text:gmatch('/>') do opens = opens - 1 end
  -- Closing tags: </tagname>
  for _ in text:gmatch('</%a') do closes = closes + 1 end
  return opens - closes
end

-- Collect the first class-bearing HTML tag from a chunk list.
local function leading_class(chunks)
  for _, txt in ipairs(chunks) do
    local cls = txt:match('class="([^"]+)"')
    if cls then return cls end
  end
  return ''
end

-- Primitive family name for a class string, used for sibling-grouping.
-- Returns a short key if class belongs to a known primitive family, else nil.
local function prim_family(cls)
  if not cls then return nil end
  if cls:find('kpi%-grid') or cls:find('kpi%-card') then return 'kpi' end
  if cls:find('kpi%-row') or cls:find('kpi%-') then return 'kpi' end
  if cls:find('keyfigure') then return 'keyfigure' end
  if cls:find('funds%-row') or cls:find('allocation') then return 'alloc' end
  if cls:find('prod') then return 'prod' end
  if cls:find('callout') then return 'callout' end
  if cls:find('recommendation') then return 'rec' end
  if cls:find('timeline') then return 'timeline' end
  return nil
end

function Pandoc(doc)
  local out = {}
  local i   = 1
  while i <= #doc.blocks do
    local b = doc.blocks[i]
    if b.t == 'RawBlock' and b.format == 'html' then
      -- Accumulate HTML RawBlocks that belong to the same primitive group.
      --
      -- Two cases:
      -- (A) CONTAINER context: first content chunk opens a tag (net_depth > 0).
      --     Keep consuming until depth returns to 0, absorbing native Para/Plain
      --     as <p> when inside the open context.
      -- (B) SIBLING context: first chunk is self-contained (net_depth == 0).
      --     Keep consuming subsequent consecutive HTML RawBlocks that belong to
      --     the same primitive family (e.g. funds-row siblings).
      --     Stop at the first non-HTML block or at an HTML block from a
      --     different family.
      local chunks   = {}
      local depth    = 0
      local j        = i
      local ctx_open = false   -- true when we entered a container context
      local fam      = nil     -- primitive family of first content chunk

      while j <= #doc.blocks do
        local blk = doc.blocks[j]

        if blk.t == 'RawBlock' and blk.format == 'html' then
          local txt = blk.text
          local t   = txt:match('^%s*(.-)%s*$')

          -- Anonymous single closer (</div>, </aside>): only consume if inside
          -- an open container context. INCLUDE in chunks (pattern matchers need
          -- the closing tags to find card boundaries).
          if t:match('^</%a[%w%-]*>$') then
            if ctx_open then
              chunks[#chunks+1] = txt  -- include the closer
              depth = depth - 1
              j = j + 1
              if depth <= 0 then break end  -- container closed
            elseif #chunks == 0 then
              -- Stray closer at the very start of a new accumulation cycle
              -- (e.g. the </div> that vocabulary.lua emits after a native pandoc
              -- Table/BulletList block inside a datatable fenced div).
              -- SKIP it: advance past it so the outer loop does not spin forever.
              j = j + 1
              break
            else
              break  -- stray closer at depth 0 — stop
            end

          -- Anonymous single opener (<div>): consume and include.
          elseif t:match('^<%a[%w%-]*>$') then
            if ctx_open then
              chunks[#chunks+1] = txt
              depth = depth + 1
              j = j + 1
            else
              break  -- bare opener at start — stop
            end

          else
            -- Content-bearing HTML chunk.
            local d   = net_depth(t)
            local cls = t:match('class="([^"]+)"')
            local f   = prim_family(cls)

            if #chunks == 0 then
              -- First chunk: establish family and context.
              chunks[#chunks+1] = txt
              fam      = f
              depth    = d
              ctx_open = (d > 0)
              j = j + 1
            elseif ctx_open then
              -- Already inside a container: keep consuming.
              chunks[#chunks+1] = txt
              depth = depth + d
              j = j + 1
              if depth <= 0 then break end
            else
              -- Sibling mode: only consume same-family siblings.
              if f == fam and fam ~= nil then
                chunks[#chunks+1] = txt
                j = j + 1
              else
                break
              end
            end
          end

        elseif ctx_open and (blk.t == 'Para' or blk.t == 'Plain') then
          -- Native para inside open container context: absorb as <p>.
          chunks[#chunks+1] = '<p>' .. xml_esc(pandoc.utils.stringify(blk)) .. '</p>'
          j = j + 1

        else
          break
        end
      end

      if #chunks > 0 then
        local combined  = table.concat(chunks, '\n')
        local eff_class = leading_class(chunks)
        local rendered  = dispatch_with_class(combined, eff_class)
        for _, rb in ipairs(rendered) do out[#out+1] = rb end
      end
      i = j
    else
      out[#out+1] = b
      i = i + 1
    end
  end

  -- Convert any RawInline('html', ...) in native paragraphs.
  local function fix_inline(el)
    if el.t == 'RawInline' and el.format == 'html' then
      local text = strip_tags(el.text)
      if text == '' then return {} end
      return pandoc.Str(text)
    end
    return el
  end

  local final = {}
  for _, blk in ipairs(out) do
    final[#final+1] = pandoc.walk_block(blk, { RawInline = fix_inline })
  end

  return pandoc.Pandoc(final, doc.meta)
end
