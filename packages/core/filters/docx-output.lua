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
-- Brand metadata helpers
-- ============================================================

-- Read brand_* metadata strings injected by server.py render_docx().
-- Returns a bare RRGGBB hex string (no #) safe for direct XML w:color values.
-- Falls back to sensible defaults when metadata is absent.

local _brand_meta_cache = {}
local function _brand_meta(key, default)
  if _brand_meta_cache[key] ~= nil then
    return _brand_meta_cache[key]
  end
  local val = default
  if PANDOC_DOCUMENT_META and PANDOC_DOCUMENT_META[key] then
    local raw = pandoc.utils.stringify(PANDOC_DOCUMENT_META[key])
    if raw and raw ~= '' then val = raw end
  end
  _brand_meta_cache[key] = val
  return val
end

-- Return a bare RRGGBB (uppercase, no #) suitable for w:color attributes.
local function _brand_color(key, default_hex)
  local raw = _brand_meta(key, default_hex)
  -- strip leading # and quotes
  local h = raw:gsub('^[#"\']+', ''):gsub('["\' ]+$', '')
  -- expand 3-digit to 6-digit
  if #h == 3 then
    h = h:sub(1,1):rep(2) .. h:sub(2,2):rep(2) .. h:sub(3,3):rep(2)
  end
  return h:upper():sub(1,6)
end

local function brand_accent() return _brand_color('brand_accent', '333333') end
local function brand_ink()    return _brand_color('brand_ink',    '111111') end
local function brand_rule()   return _brand_color('brand_rule',   'CCCCCC') end
local function brand_sans()   return _brand_meta('brand_sans',   'Calibri') end
local function brand_serif()  return _brand_meta('brand_serif',  'Calibri') end

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
  local text = el.text or ''
  if text:match('[\n\r%s]<svg[%s>]') or text:match('^<svg[%s>]') then
    local caption = text:match('class="figure%-caption">(.-)</figcaption>')
                 or text:match('class="chart%-title">(.-)</div>')
                 or text:match('class="chart%-label">(.-)</div>')
                 or 'SVG figure'
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

-- Paragraph with sized/optional-bold text and optional font/color.
-- sz is half-points (36pt = 72).
local function styled_para(text, sz, bold, color, caps, spacing_after, font)
  local b   = bold  and '<w:b/>'   or ''
  local c   = caps  and '<w:caps/>' or ''
  local col = color and ('<w:color w:val="' .. color .. '"/>') or ''
  local fnt = font  and ('<w:rFonts w:ascii="' .. xml_esc(font) .. '" w:hAnsi="' .. xml_esc(font) .. '"/>') or ''
  local sp  = spacing_after and
              ('<w:pPr><w:spacing w:after="' .. spacing_after .. '"/></w:pPr>') or
              '<w:pPr><w:spacing w:after="0"/></w:pPr>'
  return pandoc.RawBlock('openxml', string.format(
    '<w:p>%s<w:r><w:rPr>%s%s%s%s<w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
    sp, fnt, b, c, col, sz, sz, xml_esc(text)
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

-- Horizontal rule — uses brand_rule colour.
local function horiz_rule()
  local col = brand_rule()
  return pandoc.RawBlock('openxml', string.format([[
<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="%s"/></w:pBdr><w:spacing w:after="0"/></w:pPr></w:p>]], col))
end

-- Borderless table.
-- col_widths: list of twip strings.
-- rows: list of lists of raw XML cell-content strings (no <w:tc> wrapper).
local function borderless_table(col_widths, rows, header_row, alt_bg)
  -- alt_bg: optional hex colour for alternating row shading
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

  for ri, row in ipairs(rows) do
    local is_header = (ri == 1 and header_row)
    -- Shading for alternating rows (skip header row)
    local shd_xml = ''
    if alt_bg and not is_header and (ri % 2 == 0) then
      shd_xml = '<w:shd w:val="clear" w:color="auto" w:fill="' .. alt_bg .. '"/>'
    end
    parts[#parts+1] = '<w:tr>'
    for ci, cell_xml in ipairs(row) do
      local w_val = col_widths[ci] or '1700'
      -- Bold all cell content in header row by wrapping runs in <w:b/>
      local content = cell_xml
      if is_header then
        -- Inject <w:b/> into every <w:rPr> block (or add one if missing)
        content = content:gsub('<w:r>', '<w:r><w:rPr><w:b/></w:rPr>')
        content = content:gsub('(<w:rPr>)', '%1<w:b/>')
        -- Avoid double <w:b/>
        content = content:gsub('<w:b/><w:b/>', '<w:b/>')
      end
      parts[#parts+1] = '<w:tc><w:tcPr><w:tcW w:w="' .. w_val .. '" w:type="dxa"/>' .. shd_xml .. '</w:tcPr>' .. content .. '</w:tc>'
    end
    parts[#parts+1] = '</w:tr>'
  end
  parts[#parts+1] = '</w:tbl>'
  return pandoc.RawBlock('openxml', table.concat(parts, '\n'))
end

-- Bordered single-cell table (for callouts).
local function bordered_box(fill_color, content_xml, border_color)
  local bc = border_color or 'CCCCCC'
  return pandoc.RawBlock('openxml', string.format([[
<w:tbl>
<w:tblPr>
  <w:tblStyle w:val="TableGrid"/>
  <w:tblW w:w="0" w:type="auto"/>
  <w:tblBorders>
    <w:top    w:val="single" w:sz="4" w:space="0" w:color="%s"/>
    <w:left   w:val="single" w:sz="4" w:space="0" w:color="%s"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="%s"/>
    <w:right  w:val="single" w:sz="4" w:space="0" w:color="%s"/>
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
</w:tbl>]], bc, bc, bc, bc, fill_color, content_xml))
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
-- OpenXML page-break-before helper
-- ============================================================

-- Wrap a block in OpenXML that adds <w:pageBreakBefore/> to its pPr.
-- Used on H1 paragraphs to start each top-level section on a new page.
local function with_page_break_before(block)
  -- We only know how to inject this into styled paragraphs that already
  -- have a <w:pStyle> element.  For native Pandoc Header blocks (level 1)
  -- we emit a raw OpenXML paragraph that sets the Heading 1 style plus the
  -- page break, then renders the inline content normally.
  return block  -- handled in Pandoc() document filter via Header walk
end

-- ============================================================
-- Native-cover handler
-- ============================================================

local function handle_native_cover(html)
  local function field(cls)
    local v = html:match('<[a-z]+%s+class="native%-cover%-' .. cls .. '">(.-)</')
    return v and strip_tags(v) or ''
  end

  local eyebrow   = field('eyebrow')
  local subtitle  = field('subtitle')
  local metric    = field('metric')
  local statement = field('statement')
  local source    = field('source')
  local version   = field('version')

  local accent = brand_accent()
  local ink    = brand_ink()
  local serif  = brand_serif()
  local sans   = brand_sans()

  local blocks = {}

  -- Page break before the cover (reset from any preceding content)
  blocks[#blocks+1] = pandoc.RawBlock('openxml',
    '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:after="0"/></w:pPr></w:p>')

  -- Eyebrow / doc type: sans, 11pt, caps, accent
  if eyebrow ~= '' then
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="720" w:after="120"/></w:pPr>'
      ..'<w:r><w:rPr>'
      ..'<w:rFonts w:ascii="%s" w:hAnsi="%s"/>'
      ..'<w:sz w:val="22"/><w:szCs w:val="22"/>'
      ..'<w:color w:val="%s"/><w:caps/>'
      ..'</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(sans), xml_esc(sans), accent, xml_esc(eyebrow)))
  end

  -- Brand name: serif, 36pt, caps, accent
  local brandname = ''
  if PANDOC_DOCUMENT_META and PANDOC_DOCUMENT_META['brandname'] then
    brandname = pandoc.utils.stringify(PANDOC_DOCUMENT_META['brandname'])
  end
  if brandname ~= '' then
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="120"/></w:pPr>'
      ..'<w:r><w:rPr>'
      ..'<w:rFonts w:ascii="%s" w:hAnsi="%s"/>'
      ..'<w:sz w:val="72"/><w:szCs w:val="72"/>'
      ..'<w:b/><w:color w:val="%s"/><w:caps/>'
      ..'</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(serif), xml_esc(serif), accent, xml_esc(brandname)))
  end

  -- Subtitle / title: serif, 24pt, ink
  if subtitle ~= '' then
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="360" w:after="120"/></w:pPr>'
      ..'<w:r><w:rPr>'
      ..'<w:rFonts w:ascii="%s" w:hAnsi="%s"/>'
      ..'<w:sz w:val="48"/><w:szCs w:val="48"/>'
      ..'<w:color w:val="%s"/>'
      ..'</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(serif), xml_esc(serif), ink, xml_esc(subtitle)))
  end

  -- Separator rule
  if metric ~= '' or statement ~= '' then
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="%s"/></w:pBdr>'
      ..'<w:spacing w:before="480" w:after="480"/></w:pPr></w:p>',
      accent))
  end

  -- Key metric: sans, bold, 18pt, accent
  if metric ~= '' then
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="80"/></w:pPr>'
      ..'<w:r><w:rPr>'
      ..'<w:rFonts w:ascii="%s" w:hAnsi="%s"/>'
      ..'<w:sz w:val="36"/><w:szCs w:val="36"/>'
      ..'<w:b/><w:color w:val="%s"/>'
      ..'</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(sans), xml_esc(sans), accent, xml_esc(metric)))
  end

  -- Statement: sans, 10pt, ink
  if statement ~= '' then
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="120"/></w:pPr>'
      ..'<w:r><w:rPr>'
      ..'<w:rFonts w:ascii="%s" w:hAnsi="%s"/>'
      ..'<w:sz w:val="20"/><w:szCs w:val="20"/>'
      ..'<w:color w:val="%s"/>'
      ..'</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(sans), xml_esc(sans), ink, xml_esc(statement)))
  end

  -- Source / attribution: sans, 8pt, grey
  if source ~= '' then
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="120"/></w:pPr>'
      ..'<w:r><w:rPr>'
      ..'<w:rFonts w:ascii="%s" w:hAnsi="%s"/>'
      ..'<w:sz w:val="16"/><w:szCs w:val="16"/>'
      ..'<w:color w:val="888888"/>'
      ..'</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(sans), xml_esc(sans), xml_esc(source)))
  end

  -- Version: sans, 8pt, grey
  if version ~= '' then
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="80"/></w:pPr>'
      ..'<w:r><w:rPr>'
      ..'<w:rFonts w:ascii="%s" w:hAnsi="%s"/>'
      ..'<w:sz w:val="16"/><w:szCs w:val="16"/>'
      ..'<w:color w:val="888888"/>'
      ..'</w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      xml_esc(sans), xml_esc(sans), xml_esc(version)))
  end

  -- Page break after cover
  blocks[#blocks+1] = pandoc.RawBlock('openxml',
    '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>'
    ..'<w:r><w:br w:type="page"/></w:r></w:p>')

  return blocks
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

  local accent = brand_accent()
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
    -- Label: small, brand accent, caps
    cell = cell .. string.format(
      '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="%s"/><w:caps/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      accent, xml_esc(label))
    -- Value: large bold, ink
    cell = cell .. string.format(
      '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/><w:color w:val="%s"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      brand_ink(), xml_esc(value))
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

  local accent = brand_accent()
  local ink    = brand_ink()

  local blocks = {}
  if value ~= '' then
    -- Value: large, bold, accent colour
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>'
      ..'<w:r><w:rPr><w:b/><w:sz w:val="72"/><w:szCs w:val="72"/>'
      ..'<w:color w:val="%s"/></w:rPr>'
      ..'<w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      accent, xml_esc(value)))
  end
  if label ~= '' then
    -- Label: medium, ink, caps
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr>'
      ..'<w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/>'
      ..'<w:color w:val="%s"/></w:rPr>'
      ..'<w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      ink, xml_esc(label)))
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
      '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="%s"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      brand_accent(), xml_esc(bar))
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
        '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="%s"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
        brand_accent(), xml_esc(bar))
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
-- Callout border colours: semantic types use fixed palette tokens;
-- unrecognised types fall back to brand_accent.
local KIND_COLOR = {
  note    = nil,  -- uses brand_accent (filled below)
  info    = nil,  -- uses brand_accent
  warning = 'C97A00',
  risk    = '9B2C2C',
  success = '1F6B45',
}

local function handle_callout(html)
  local kind  = html:match('data%-kind="([^"]*)"') or 'note'
  local title = strip_tags(html:match('<div class="callout%-title">(.-)</div>') or '')

  local icon  = KIND_ICON[kind]  or KIND_ICON.note
  local lbl   = KIND_LABEL[kind] or 'NOTE'
  local header_text = icon .. ' ' .. lbl .. (title ~= '' and (': ' .. title) or '')

  -- Border colour: semantic for warning/risk/success, brand_accent otherwise
  local border_col = KIND_COLOR[kind] or brand_accent()

  local header_xml = string.format(
    '<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="%s"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>',
    border_col, xml_esc(header_text))

  -- Extract body: everything after the callout-title div (or the whole block).
  local body_html = html:match('<div class="callout%-title">[^<]*</div>(.*)</aside>') or
                    html:match('<aside[^>]*>(.*)</aside>') or ''
  body_html = body_html:gsub('<div class="callout%-title">[^<]*</div>', '')

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

  return { bordered_box('F5F5F5', header_xml .. body_xml, border_col) }
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
    -- Header in brand accent colour
    blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
      '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>'
      ..'<w:r><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/>'
      ..'<w:color w:val="%s"/></w:rPr>'
      ..'<w:t xml:space="preserve">%s</w:t></w:r></w:p>',
      brand_accent(), xml_esc(head_text)))
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
  local accent = brand_accent()
  -- Match each timeline-event. The body content follows after timeline-title.
  for event_html in html:gmatch('<div class="timeline%-event">(.-)</div>%s*</div>') do
    local date  = strip_tags(event_html:match('<div class="timeline%-date">(.-)</div>') or '')
    local title = strip_tags(event_html:match('<div class="timeline%-title">(.-)</div>') or '')
    local head  = (date ~= '' and (date .. ' \xe2\x80\x94 ') or '') .. title

    if head ~= '' then
      -- Timeline event heading in brand accent
      blocks[#blocks+1] = pandoc.RawBlock('openxml', string.format(
        '<w:p><w:pPr><w:spacing w:after="40"/></w:pPr>'
        ..'<w:r><w:rPr><w:b/><w:sz w:val="20"/><w:szCs w:val="20"/>'
        ..'<w:color w:val="%s"/></w:rPr>'
        ..'<w:t xml:space="preserve">%s</w:t></w:r></w:p>',
        accent, xml_esc(head)))
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
  local cards = {}
  for n_val, l_val in html:gmatch('<span class="kpi%-n">([^<]*)</span>%s*<span class="kpi%-l">([^<]*)</span>') do
    cards[#cards+1] = { value = strip_tags(n_val), label = strip_tags(l_val) }
  end
  if #cards == 0 then return generic_html_to_blocks(html) end

  local n = #cards
  local col_w = tostring(math.floor(6800 / n))
  local col_widths = {}
  for _ = 1, n do col_widths[#col_widths+1] = col_w end

  local accent = brand_accent()
  local cells = {}
  for _, card in ipairs(cards) do
    local cell = string.format(
      '<w:p><w:pPr><w:spacing w:after="20"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/><w:color w:val="%s"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
      accent, xml_esc(card.value))
    cell = cell .. string.format(
      '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="888888"/></w:rPr><w:t>%s</w:t></w:r></w:p>',
      xml_esc(card.label))
    cells[#cells+1] = cell
  end

  return { borderless_table(col_widths, { cells }) }
end

-- ----- Generic HTML table styling -----
-- Applied by generic_html_to_blocks fallback results when they produce Table blocks.
-- Wraps a pandoc Table in OpenXML with header-row bolding and light alt shading.
local function style_html_table(blocks)
  -- We only restyle pandoc Table AST nodes; everything else passes through.
  local out = {}
  for _, blk in ipairs(blocks) do
    if blk.t == 'Table' then
      -- Render as plain pandoc table (the DOCX writer handles it),
      -- but apply a styled wrapper.  Since we can't inject w:tblPr directly
      -- into a pandoc Table here, we use the fallback: let pandoc render it,
      -- then emit a pre/post rule using brand_rule.
      out[#out+1] = horiz_rule()
      out[#out+1] = blk
      out[#out+1] = horiz_rule()
    else
      out[#out+1] = blk
    end
  end
  return out
end

-- Override generic_html_to_blocks to apply table styling.
local _orig_generic = generic_html_to_blocks
generic_html_to_blocks = function(html)
  local blocks = _orig_generic(html)
  -- Check if any block is a table and apply styling
  local has_table = false
  for _, b in ipairs(blocks) do
    if b.t == 'Table' then has_table = true; break end
  end
  if has_table then
    return style_html_table(blocks)
  end
  return blocks
end

-- ============================================================
-- Dispatch
-- ============================================================

local function dispatch_with_class(html, eff_class)
  local class = eff_class or html:match('class="([^"]+)"') or ''

  -- native-cover: handled before other classes
  if class:find('native%-cover') or html:match('<section class="native%-cover"') then
    return handle_native_cover(html)
  elseif class:find('kpi%-grid') or class:find('kpi%-card') then
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
  elseif class:find('section%-opener') or html:match('<div class="section%-opener"') then
    -- section-opener divs are CSS/PDF-only constructs: ghost number, eyebrow
    -- label, logo, and a raw <h1> tag. The heading is already emitted as a
    -- clean Heading 1 paragraph by the toc-anchor handler in Pandoc() above.
    -- Passing this through generic_html_to_blocks() produces a second copy.
    return {}
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
  for t in text:gmatch('<(%a[%w%-]*)') do
    if t then opens = opens + 1 end
  end
  for _ in text:gmatch('/>') do opens = opens - 1 end
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
local function prim_family(cls)
  if not cls then return nil end
  if cls:find('native%-cover') then return 'native-cover' end
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

-- ============================================================
-- Header level-1 → page-break-before OpenXML
-- ============================================================
-- Single shared counter for ALL H1s (toc-anchor or plain).
-- Prevents the "first H1" skip from being reset when H1s use
-- different code paths (e.g. .no-eyebrow skips toc-anchor path).
local _h1_total = 0
-- Flag set to true each time the toc-anchor handler emits an H1.
-- The section-opener accumulated chunk always follows immediately;
-- if this flag is true when we see a section-opener or a bare <h1>
-- inside one, we suppress it (already rendered above).
local _section_h1_emitted = false

-- Emit a tiny invisible paragraph whose only purpose is to trigger
-- a page break before the next (H1) paragraph.
-- We use a zero-height run with a <w:br w:type="page"/> rather than
-- replacing the styled Heading 1 paragraph, so pandoc's own DOCX writer
-- still applies the reference.docx Heading 1 style (correct font/size/colour)
-- to the heading text.
local function page_break_para()
  return pandoc.RawBlock('openxml',
    '<w:p>'
    ..'<w:pPr><w:spacing w:before="0" w:after="0"/>'
    ..'<w:rPr><w:sz w:val="2"/></w:rPr>'
    ..'</w:pPr>'
    ..'<w:r><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>'
    ..'<w:br w:type="page"/>'
    ..'</w:r></w:p>'
  )
end

function Pandoc(doc)
  local out = {}
  local i   = 1
  while i <= #doc.blocks do
    local b = doc.blocks[i]

    -- H1 toc-anchor headers (emitted by vocabulary.lua before each section):
    -- These exist solely for pandoc TOC generation. vocabulary.lua also emits
    -- a <div class="section-opener"> containing the actual rendered heading,
    -- so if we pass the toc-anchor through as a visible Header we get a
    -- duplicate. Instead: inject a page break (after the first section) and
    -- emit the heading from the toc-anchor content, then skip the following
    -- section-opener RawBlocks which would otherwise produce more duplicates.
    if b.t == 'Header' and b.level == 1
       and (b.classes:includes('toc-anchor') or b.classes:includes('unnumbered')) then
      -- vocabulary.lua emits for every H1:
      --   1. toc-anchor Header (for TOC — we are here)
      --   2. RawBlock '<div class="section-opener">'
      --   3. RawBlock '<div class="section-ghost" ...>NN</div>'
      --   4. (optional) RawBlock '<img class="section-opener-logo" ...>'
      --   5. (optional) RawBlock '<span class="section-string-set" ...>'
      --   6. RawBlock '<div class="section-number" data-index="NN">...label...</div>'
      --   7. RawBlock '<h1 ...>heading text</h1>'
      --   8. RawBlock '</div>'
      --
      -- Goal: emit a page break (after the first section), then a small-caps
      -- eyebrow paragraph ("03 · SECTION III" in accent colour), then the H1.
      -- Consume ALL the section-opener RawBlocks that follow so they produce
      -- no output of their own.

      _h1_total = (_h1_total or 0) + 1
      if _h1_total > 1 then
        out[#out+1] = page_break_para()
      end
      _section_h1_emitted = true  -- suppress section-opener <h1> that follows

      -- Peek ahead: collect the section-opener RawBlocks and extract the
      -- eyebrow label from the section-number div.
      local eyebrow_num   = nil
      local eyebrow_label = nil
      local j = i + 1
      while j <= #doc.blocks do
        local nb = doc.blocks[j]
        if nb.t == 'RawBlock' and nb.format == 'html' then
          local txt = nb.text
          -- Extract section number and label from section-number div
          local idx = txt:match('data%-index="(%d+)"')
          if idx then eyebrow_num = idx end
          local lbl = txt:match('<span class="section%-number%-label">(.-)</span>')
          if lbl then
            -- strip any inner HTML tags
            eyebrow_label = lbl:gsub('<[^>]+>', '')
                               :gsub('&amp;', '&'):gsub('&lt;', '<'):gsub('&gt;', '>')
                               :gsub('&quot;', '"'):gsub('&#39;', "'")
          end
          j = j + 1
          -- Stop after the closing </div> of the section-opener wrapper
          local t = txt:match('^%s*(.-)%s*$') or ''
          if t == '</div>' then break end
        else
          break
        end
      end
      i = j  -- advance past all consumed section-opener blocks

      -- Emit eyebrow paragraph: "03 · SECTION LABEL" in small caps, accent colour
      if eyebrow_num and eyebrow_label then
        local accent = brand_accent()
        local sans   = brand_sans()
        local eyebrow_text = eyebrow_num .. ' · ' .. eyebrow_label:upper()
        out[#out+1] = pandoc.RawBlock('openxml', string.format(
          '<w:p><w:pPr><w:spacing w:before="240" w:after="60"/></w:pPr>'
          ..'<w:r><w:rPr>'
          ..'<w:rFonts w:ascii="%s" w:hAnsi="%s"/>'
          ..'<w:smallCaps/>'
          ..'<w:color w:val="%s"/>'
          ..'<w:sz w:val="18"/><w:szCs w:val="18"/>'
          ..'<w:spacing w:val="60"/>'
          ..'</w:rPr>'
          ..'<w:t xml:space="preserve">%s</w:t>'
          ..'</w:r></w:p>',
          xml_esc(sans), xml_esc(sans), accent, xml_esc(eyebrow_text)
        ))
      end

      -- Emit clean H1 (reference.docx Heading 1 style supplies font/colour)
      local clean = pandoc.Header(1, b.content, pandoc.Attr(b.identifier, {}, {}))
      out[#out+1] = clean

    -- Plain H1 headers (.no-eyebrow etc): page break + heading, same counter.
    elseif b.t == 'Header' and b.level == 1 then
      _h1_total = (_h1_total or 0) + 1
      if _h1_total > 1 then
        out[#out+1] = page_break_para()
      end
      _section_h1_emitted = false  -- plain H1s have no section-opener following
      out[#out+1] = b
      i = i + 1

    elseif b.t == 'RawBlock' and b.format == 'html' then
      -- Accumulate HTML RawBlocks that belong to the same primitive group.
      local chunks   = {}
      local depth    = 0
      local j        = i
      local ctx_open = false
      local fam      = nil

      while j <= #doc.blocks do
        local blk = doc.blocks[j]

        if blk.t == 'RawBlock' and blk.format == 'html' then
          local txt = blk.text
          local t   = txt:match('^%s*(.-)%s*$')

          if t:match('^</%a[%w%-]*>$') then
            if ctx_open then
              chunks[#chunks+1] = txt
              depth = depth - 1
              j = j + 1
              if depth <= 0 then break end
            elseif #chunks == 0 then
              j = j + 1
              break
            else
              break
            end

          elseif t:match('^<%a[%w%-]*>$') then
            if ctx_open then
              chunks[#chunks+1] = txt
              depth = depth + 1
              j = j + 1
            else
              break
            end

          else
            local d   = net_depth(t)
            local cls = t:match('class="([^"]+)"')
            local f   = prim_family(cls)

            if #chunks == 0 then
              chunks[#chunks+1] = txt
              fam      = f
              depth    = d
              ctx_open = (d > 0)
              j = j + 1
            elseif ctx_open then
              chunks[#chunks+1] = txt
              depth = depth + d
              j = j + 1
              if depth <= 0 then break end
            else
              if f == fam and fam ~= nil then
                chunks[#chunks+1] = txt
                j = j + 1
              else
                break
              end
            end
          end

        elseif ctx_open and (blk.t == 'Para' or blk.t == 'Plain') then
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
