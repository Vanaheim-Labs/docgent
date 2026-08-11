-- DocForge vocabulary filter.
-- Translates fenced divs into semantic HTML with data-attributes for CSS.

-- Source-line mapping (preview only).
--
-- Pandoc does not expose source positions to filters, so each top-level block
-- is matched back to the markdown that produced it. The studio preview uses
-- these anchors to align its two panes; the PDF path never sets the flag, so
-- its output is byte-identical to before this existed.
local SRC = nil

local function source_text()
  if SRC ~= nil then return SRC end
  SRC = {}
  local inputs = PANDOC_STATE and PANDOC_STATE.input_files or {}
  local path = inputs[1]
  if path then
    local fh = io.open(path, 'r')
    if fh then
      local n = 0
      for line in fh:lines() do
        n = n + 1
        SRC[n] = line
      end
      fh:close()
    end
  end
  return SRC
end

-- First source line at or after 'from' that contains the start of 'needle'.
local function find_line(needle, from)
  local lines = source_text()
  if not needle or needle == '' then return nil end
  local squash = [[%s+]]
  local probe = needle:sub(1, 40):gsub(squash, ' ')
  probe = probe:match([[^%s*(.-)%s*$]]) or probe
  if probe == '' then return nil end
  for i = math.max(from or 1, 1), #lines do
    local hay = lines[i]:gsub(squash, ' ')
    if hay:find(probe, 1, true) then return i end
  end
  return nil
end

local function attrget(el, key, default)
  return el.attributes[key] or default
end

local function raw(s) return pandoc.RawBlock('html', s) end


-- Renders a list of inlines to plain text (for labels inside generated chrome).
local function inlines_to_text(inlines)
  return pandoc.utils.stringify(inlines)
end

-- Splits 'Label - sublabel' into two parts. Long-bracket strings are used for
-- every pattern below: these contain % and quotes, which is exactly what kept
-- breaking when they were written as escaped single-quoted strings.
local function split_label(s)
  -- Long brackets are raw, so \226 escapes do not work inside them.
  -- Build the em/en dash bytes explicitly instead.
  local em = string.char(226, 128, 148)
  local en = string.char(226, 128, 147)
  local seps = { em, en, '%-%-' }
  for _, sep in ipairs(seps) do
    local a, b = s:match([[^(.-)%s*]] .. sep .. [[%s*(.+)$]])
    if a then return a, b end
  end
  return s, nil
end

-- Items of the first bullet/ordered list inside a block list.
local function first_list_items(blocks)
  for _, b in ipairs(blocks) do
    if b.t == 'BulletList' or b.t == 'OrderedList' then return b.content end
  end
  return nil
end

local function esc(s)
  if s == nil then return '' end
  return s:gsub('&','&amp;'):gsub('<','&lt;'):gsub('>','&gt;'):gsub('"','&quot;')
end

function Div(el)
  local classes = el.classes

  local function has(c) return classes:includes(c) end

  if has('callout') then
    local kind = attrget(el, 'kind', 'note')
    local title = el.attributes['title']
    local out = { raw('<aside class="callout" data-kind="' .. esc(kind) .. '">') }
    if title then
      table.insert(out, raw('<div class="callout-title">' .. esc(title) .. '</div>'))
    end
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</aside>'))
    return out

  elseif has('pullquote') then
    local size = attrget(el, 'size', 'normal')
    local attribution = el.attributes['attribution']
    local out = { raw('<figure class="pullquote" data-size="' .. esc(size) .. '">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    if attribution then
      table.insert(out, raw('<figcaption class="pullquote-attribution">' .. esc(attribution) .. '</figcaption>'))
    end
    table.insert(out, raw('</figure>'))
    return out

  elseif has('keyfigure') then
    local value = attrget(el, 'value', '')
    local label = attrget(el, 'label', '')
    local trend = attrget(el, 'trend', 'none')
    local out = {
      raw('<div class="keyfigure" data-trend="' .. esc(trend) .. '">'),
      raw('<div class="keyfigure-value">' .. esc(value) .. '</div>'),
      raw('<div class="keyfigure-label">' .. esc(label) .. '</div>'),
      raw('<div class="keyfigure-body">')
    }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div></div>'))
    return out

  elseif has('figure') then
    local src = attrget(el, 'src', '')
    local caption = el.attributes['caption']
    local source = el.attributes['source']
    local width = attrget(el, 'width', 'column')
    local out = {
      raw('<figure class="figure" data-width="' .. esc(width) .. '">'),
      raw('<img src="' .. esc(src) .. '" alt="' .. esc(caption or '') .. '">')
    }
    if caption then
      table.insert(out, raw('<figcaption class="figure-caption">' .. esc(caption) .. '</figcaption>'))
    end
    if source then
      table.insert(out, raw('<div class="figure-source">Source: ' .. esc(source) .. '</div>'))
    end
    table.insert(out, raw('</figure>'))
    return out

  elseif has('datatable') then
    local dense = attrget(el, 'dense', 'false')
    local caption = el.attributes['caption']
    local widths = el.attributes['widths']
    local style = ''
    local out = { raw('<div class="datatable" data-dense="' .. esc(dense) .. '"' .. style .. '>') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    if caption then
      table.insert(out, raw('<div class="datatable-caption">' .. esc(caption) .. '</div>'))
    end
    table.insert(out, raw('</div>'))
    -- column widths via inline colgroup is handled in post-process
    if widths then
      el.attributes['data-widths'] = widths
    end
    return out

  elseif has('note') then
    -- Editorial direction for the next AI pass. Never part of the document.
    -- Emitted so Studio's preview can show it as a margin flag; hidden in print.
    local author = el.attributes['author']
    local resolved = attrget(el, 'resolved', 'false')
    local head = '<aside class="note" data-resolved="' .. esc(resolved) .. '"'
    if author then head = head .. ' data-author="' .. esc(author) .. '"' end
    head = head .. '>'
    local out = { raw(head) }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</aside>'))
    return out

  elseif has('summary') then
    local out = { raw('<section class="summary">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</section>'))
    return out

  elseif has('recommendation') then
    local ref = el.attributes['ref']
    local owner = el.attributes['owner']
    local priority = attrget(el, 'priority', 'medium')
    local out = { raw('<div class="recommendation" data-priority="' .. esc(priority) .. '">') }
    local head = '<div class="recommendation-head">'
    if ref then head = head .. '<span class="recommendation-ref">' .. esc(ref) .. '</span>' end
    head = head .. '<span class="recommendation-priority">' .. esc(priority) .. '</span>'
    if owner then head = head .. '<span class="recommendation-owner">Owner: ' .. esc(owner) .. '</span>' end
    head = head .. '</div>'
    table.insert(out, raw(head))
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('definition') then
    local term = attrget(el, 'term', '')
    local out = {
      raw('<div class="definition">'),
      raw('<div class="definition-term">' .. esc(term) .. '</div>')
    }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('columns') then
    local count = attrget(el, 'count', '2')
    local out = { raw('<div class="columns" data-count="' .. esc(count) .. '">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('pagebreak') then
    local to = attrget(el, 'to', 'any')
    return { raw('<div class="pagebreak" data-to="' .. esc(to) .. '"></div>') }

  elseif has('landscape') then
    local out = { raw('<section class="landscape">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</section>'))
    return out

  elseif has('appendix') then
    local out = { raw('<section class="appendix">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</section>'))
    return out


  elseif has('exec-intro') then
    local eyebrow = el.attributes['eyebrow']
    local out = { raw('<section class="exec-intro">') }
    if eyebrow then
      table.insert(out, raw('<div class="exec-intro-eyebrow">' .. esc(eyebrow) .. '</div>'))
    end
    table.insert(out, raw('<div class="exec-intro-pull">'))
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div></section>'))
    return out

  elseif has('funnel') then
    local items = first_list_items(el.content)
    if not items then return el end
    local out = { raw('<div class="funnel">') }
    for i, item in ipairs(items) do
      local label, sub = split_label(inlines_to_text(item))
      local step = '<div class="funnel-step">' .. esc(label)
      if sub then
        step = step .. '<span class="funnel-sublabel">' .. esc(sub) .. '</span>'
      end
      table.insert(out, raw(step .. '</div>'))
      if i < #items then
        local even = ''
        if i % 2 == 0 then even = ' even' end
        table.insert(out, raw('<div class="funnel-arrow' .. even .. '"></div>'))
      end
    end
    table.insert(out, raw('</div>'))
    return out

  elseif has('milestones') then
    local out = { raw('<div class="milestone-grid">') }
    local open = false
    for _, b in ipairs(el.content) do
      if b.t == 'Header' and b.level == 3 then
        if open then table.insert(out, raw('</div>')) end
        table.insert(out, raw('<div class="milestone-box">'))
        table.insert(out, raw('<div class="milestone-label">' .. esc(inlines_to_text(b.content)) .. '</div>'))
        open = true
      else
        table.insert(out, b)
      end
    end
    if open then table.insert(out, raw('</div>')) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('allocation') then
    -- Each item is 'Label - NN%'. Bar width comes from the percentage, so the
    -- diagram cannot drift from the number printed beside it.
    local items = first_list_items(el.content)
    if not items then return el end
    local out = {}
    for _, item in ipairs(items) do
      local text = inlines_to_text(item)
      local label, rest = split_label(text)
      local n = nil
      if rest then n = rest:match([[(%d+%.?%d*)%s*%%]]) end
      if not n then
        local l2, n2 = text:match([[^(.-)%s+(%d+%.?%d*)%s*%%%s*$]])
        if n2 then label = l2; n = n2 end
      end
      if n then
        table.insert(out, raw(
          '<div class="funds-row">' ..
          '<div class="funds-label">' .. esc(label) .. '</div>' ..
          '<div class="funds-bar-wrap"><div class="funds-bar" style="width:' .. n .. '%"></div></div>' ..
          '<div class="funds-pct">' .. esc(n) .. '%</div>' ..
          '</div>'))
      end
    end
    if #out == 0 then return el end
    return out
  elseif has('kpigrid') then
    -- Row of metric cards. Column count is a data-attribute AND a class so the
    -- brand CSS (.kpi-grid-2/3) and any core CSS keyed on data-cols both work.
    local cols = attrget(el, 'cols', '4')
    if cols ~= '2' and cols ~= '3' and cols ~= '4' then cols = '4' end
    local cls = 'kpi-grid'
    if cols ~= '4' then cls = cls .. ' kpi-grid-' .. cols end
    local out = { raw('<div class="' .. cls .. '" data-cols="' .. esc(cols) .. '">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('kpicard') then
    -- Label sits above the value; the source pill rides in the label line so a
    -- reader can see provenance without a legend. Body content is optional and
    -- rendered under the change line.
    local value = attrget(el, 'value', '')
    local label = attrget(el, 'label', '')
    local change = el.attributes['change']
    local trend = attrget(el, 'trend', 'flat')
    local color = el.attributes['color']
    local source = el.attributes['source']

    local cls = 'kpi-card'
    if color then cls = cls .. ' ' .. esc(color) end

    local head = '<div class="' .. cls .. '" data-trend="' .. esc(trend) .. '">'
    local lab = '<div class="kpi-label">' .. esc(label)
    if source then
      lab = lab .. '<span class="source-tag source-' .. esc(source) .. '">' ..
            esc(source:upper()) .. '</span>'
    end
    lab = lab .. '</div>'

    local out = {
      raw(head),
      raw(lab),
      raw('<div class="kpi-value">' .. esc(value) .. '</div>')
    }
    if change then
      -- 'flat' maps to the neutral colour class the brand already ships.
      local tcls = trend
      if trend == 'flat' or trend == 'none' then tcls = 'neutral' end
      table.insert(out, raw('<div class="kpi-change ' .. esc(tcls) .. '">' .. esc(change) .. '</div>'))
    end
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('daygrid') then
    local out = { raw('<div class="weekly-grid">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('daycell') then
    local day = attrget(el, 'day', '')
    local value = attrget(el, 'value', '')
    local state = el.attributes['state']
    local cls = 'day-cell'
    if state then cls = cls .. ' ' .. esc(state) end
    return {
      raw('<div class="' .. cls .. '">' ..
          '<div class="day-label">' .. esc(day) .. '</div>' ..
          '<div class="day-value">' .. esc(value) .. '</div>' ..
          '</div>')
    }

  elseif has('tensionbox') then
    local title = attrget(el, 'title', '')
    local out = { raw('<div class="tension-box">') }
    if title ~= '' then
      table.insert(out, raw('<div class="tension-title">' .. esc(title) .. '</div>'))
    end
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('signature') then
    local name = attrget(el, 'name', '')
    local role = el.attributes['role']
    local date = el.attributes['date']
    local out = { raw('<div class="signature">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('<div class="signature-name">' .. esc(name) .. '</div>'))
    if role then table.insert(out, raw('<div class="signature-role">' .. esc(role) .. '</div>')) end
    if date then table.insert(out, raw('<div class="signature-date">' .. esc(date) .. '</div>')) end
    table.insert(out, raw('</div>'))
    return out
  end

  return el
end

-- Auto-number top-level headings unless explicitly opted out.
--
-- Also emits the section eyebrow ('● 01 · SECTION LABEL') ahead of each h1.
-- The eyebrow is a separate block rather than an ::before on the heading so
-- that its label can differ from the heading text: brands set short display
-- headings while the eyebrow (and TOC) carry the long navigational label.
--
-- Precedence for the eyebrow label:
--   1. explicit  {eyebrow="..."}  attribute
--   2. explicit  {nav-title="..."} attribute
--   3. the heading text itself
-- Suppress on a given heading with .no-eyebrow, or document-wide by not
-- styling .section-number in the brand.
local H1_SEEN = 0
local NO_AUTONUMBER = false

-- Called once before any Header; reads brand metadata set by the render pipeline.
function Meta(meta)
  if meta.docforge_no_autonumber then
    NO_AUTONUMBER = true
  end
  return meta
end

function Header(el)
  if not NO_AUTONUMBER and el.level <= 2 and not el.classes:includes('unnumbered') then
    el.classes:insert('numbered')
  end

  if el.level ~= 1 or el.classes:includes('no-eyebrow') then
    return el
  end

  H1_SEEN = H1_SEEN + 1

  -- nav-title carries the long label for the TOC; the heading keeps the short
  -- display form. Defaults to the heading text so authors write one heading.
  local nav = el.attributes['nav-title']
  if nav then
    el.attributes['data-nav-title'] = nav
  end

  local label = el.attributes['eyebrow'] or nav or inlines_to_text(el.content)
  local num = string.format('%02d', H1_SEEN)

  local eyebrow = raw(
    '<div class="section-number" data-index="' .. num .. '">' ..
    '<span class="section-number-num">' .. num .. '</span>' ..
    '<span class="section-number-sep">·</span>' ..
    '<span class="section-number-label">' .. esc(label) .. '</span>' ..
    '</div>')

  return { eyebrow, el }
end


-- Inline accent span: the orange italic tail on a heading.
--   ## Why owners [will pay]{.accent}
-- Rendered as <em class="accent">, which brands already style via 'h1 em'.
function Span(el)
  if el.classes:includes('accent') then
    local out = { pandoc.RawInline('html', '<em class="accent">') }
    for _, i in ipairs(el.content) do table.insert(out, i) end
    table.insert(out, pandoc.RawInline('html', '</em>'))
    return out
  end
  if el.classes:includes('claim') then
    local kind = el.attributes['kind'] or 'gated'
    local out = { pandoc.RawInline('html', '<span class="class-label ' .. esc(kind) .. '">') }
    for _, i in ipairs(el.content) do table.insert(out, i) end
    table.insert(out, pandoc.RawInline('html', '</span>'))
    return out
  end
  return el
end

-- Stamps top-level blocks with their originating source line.
--
-- Document-level pass so doc.meta is readable before blocks are emitted.
function Pandoc(doc)
  if not doc.meta or not doc.meta.docforge_source_lines then return doc end
  local cursor = 1
  local out = {}
  for _, b in ipairs(doc.blocks) do
    local text = pandoc.utils.stringify(b)
    local line = find_line(text, cursor)
    if line then cursor = line end
    if line and (b.t == 'Div' or b.t == 'Header') then
      b.attributes['data-source-line'] = tostring(line)
      table.insert(out, b)
    elseif line then
      local wrap = pandoc.Div({ b })
      wrap.attributes['data-source-line'] = tostring(line)
      wrap.classes:insert('src-anchor')
      table.insert(out, wrap)
    else
      table.insert(out, b)
    end
  end
  return pandoc.Pandoc(out, doc.meta)
end
