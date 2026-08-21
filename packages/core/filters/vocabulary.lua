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
    -- Accept type=/label= (Tifin convention) alongside kind=/title= (core convention)
    local kind = attrget(el, 'kind', attrget(el, 'type', 'note'))
    local title = el.attributes['title'] or el.attributes['label']
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
    -- Phase F: if src is non-empty, emit <img>. Otherwise pass content through
    -- directly — allows inline SVG, raw HTML, or any other block content.
    local src     = el.attributes['src'] or ''
    local caption = el.attributes['caption']
    local source  = el.attributes['source']
    local width   = attrget(el, 'width', 'column')
    local out     = { raw('<figure class="figure" data-width="' .. esc(width) .. '">') }
    if src ~= '' then
      table.insert(out, raw('<img src="' .. esc(src) .. '" alt="' .. esc(caption or '') .. '">'))
    else
      -- Content passthrough: inline SVG, raw HTML, tables, etc.
      for _, b in ipairs(el.content) do table.insert(out, b) end
    end
    if caption then
      table.insert(out, raw('<figcaption class="figure-caption">' .. esc(caption) .. '</figcaption>'))
    end
    if source then
      table.insert(out, raw('<div class="figure-source">Source: ' .. esc(source) .. '</div>'))
    end
    table.insert(out, raw('</figure>'))
    return out

  elseif has('chart') then
    -- Phase F: chart primitive. Wraps any content (SVG, raw HTML) in figure.chart
    -- with optional chart-label (teal caps), chart-title (Crimson Pro 14pt), figcaption.
    local label   = el.attributes['label']
    local title   = el.attributes['title']
    local caption = el.attributes['caption']
    local source  = el.attributes['source']
    local out     = { raw('<figure class="figure chart">') }
    if label then
      table.insert(out, raw('<div class="chart-label">' .. esc(label) .. '</div>'))
    end
    if title then
      table.insert(out, raw('<div class="chart-title">' .. esc(title) .. '</div>'))
    end
    for _, b in ipairs(el.content) do table.insert(out, b) end
    if caption then
      table.insert(out, raw('<figcaption class="figure-caption">' .. esc(caption) .. '</figcaption>'))
    end
    if source then
      table.insert(out, raw('<div class="figure-source">Source: ' .. esc(source) .. '</div>'))
    end
    table.insert(out, raw('</figure>'))
    return out

  elseif has('raw-html') or has('rawhtml') then
    -- Phase F: pure HTML passthrough. Content passes through unchanged.
    local out = {}
    for _, b in ipairs(el.content) do table.insert(out, b) end
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

  elseif has('kpi-row') or has('kpirow') then
    -- ::kpi-row  horizontal stat panel. Items are bullet list with value:/label: pairs.
    -- Pandoc stringifies each item as "value: $7.8B label: Total advice market p.a."
    -- because the YAML-style indented continuation is rendered as plain inline text
    -- with a SoftBreak. We split on the literal "label:" keyword to extract both parts.
    local items = first_list_items(el.content)
    local stats = {}
    if items then
      for _, item in ipairs(items) do
        local text = inlines_to_text(item)
        -- Pattern: "value: VAL label: LBL" (SoftBreaks become spaces in stringify)
        local val = text:match('[Vv]alue%s*:%s*(.-)%s+[Ll]abel%s*:')
        local lbl = text:match('[Ll]abel%s*:%s*(.+)$')
        if val and lbl then
          table.insert(stats, { value = val:match('^%s*(.-)%s*$'), label = lbl:match('^%s*(.-)%s*$') })
        else
          -- Fallback: first token before space is value, rest is label
          local v, l = text:match('^(%S+)%s+(.+)$')
          if v then table.insert(stats, { value = v, label = l or '' })
          else table.insert(stats, { value = text, label = '' }) end
        end
      end
    end
    local out = { raw('<div class="kpi-row">') }
    for _, stat in ipairs(stats) do
      table.insert(out, raw(
        '<div class="kpi">' ..
        '<span class="kpi-n">' .. esc(stat.value) .. '</span>' ..
        '<span class="kpi-l">' .. esc(stat.label) .. '</span>' ..
        '</div>'
      ))
    end
    table.insert(out, raw('</div>'))
    return out

  elseif has('key-figure') or has('keyfig') then
    -- ::key-figure  single big stat with value:, label:, source: lines.
    -- Content may arrive as a single paragraph block where newlines become spaces.
    -- Use keyword anchors to split the concatenated string.
    local text = ''
    for _, b in ipairs(el.content) do text = text .. pandoc.utils.stringify(b) .. ' ' end
    -- Extract value: stops at label: or source:
    local value  = text:match('[Vv]alue%s*:%s*(.-)%s+[Ll]abel%s*:')
              or text:match('[Vv]alue%s*:%s*(.-)%s+[Ss]ource%s*:')
              or text:match('[Vv]alue%s*:%s*(.+)$') or ''
    -- Extract label: stops at source:
    local label  = text:match('[Ll]abel%s*:%s*(.-)%s+[Ss]ource%s*:')
              or text:match('[Ll]abel%s*:%s*(.+)$') or ''
    local source = text:match('[Ss]ource%s*:%s*(.+)$')
    value  = value:match('^%s*(.-)%s*$') or value
    label  = label:match('^%s*(.-)%s*$') or label
    local out = {
      raw('<div class="keyfigure">'),
      raw('<div class="keyfigure-value">' .. esc(value) .. '</div>'),
      raw('<div class="keyfigure-label">' .. esc(label) .. '</div>')
    }
    if source then
      table.insert(out, raw('<div class="keyfigure-body">' .. esc(source:match('^%s*(.-)%s*$')) .. '</div>'))
    end
    table.insert(out, raw('</div>'))
    return out

  elseif has('risk') then
    -- ::risk{severity="high|medium|low"}
    local severity  = attrget(el, 'severity', attrget(el, 'level', 'medium'))
    local badge_cls = severity == 'high' and 'b-high' or (severity == 'low' and 'b-low' or 'b-med')
    local badge_lbl = severity:sub(1,1):upper() .. severity:sub(2)
    local title_text, body_blocks = '', {}
    local found = false
    for _, b in ipairs(el.content) do
      if not found and b.t == 'Para' then title_text = pandoc.utils.stringify(b); found = true
      else table.insert(body_blocks, b) end
    end
    local out = {
      raw('<div class="risk">'),
      raw('<div class="risk-hd">' ..
          '<div class="risk-t">' .. esc(title_text) .. '</div>' ..
          '<div class="risk-b"><span class="badge ' .. badge_cls .. '">' .. badge_lbl .. '</span></div>' ..
          '</div>')
    }
    for _, b in ipairs(body_blocks) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('implication') then
    local label = el.attributes['label'] or 'Implication'
    local out = { raw('<div class="implication"><div class="implication-label">' .. esc(label) .. '</div>') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('disclaimer') then
    local out = { raw('<div class="disclaimer">') }
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('bignum') then
    local value  = attrget(el, 'value', '')
    local label  = el.attributes['label'] or ''
    local source = el.attributes['source']
    local out = {
      raw('<div class="bignum">'),
      raw('<span class="bignum-v">' .. esc(value) .. '</span>'),
      raw('<div class="bignum-l">' .. esc(label) .. '</div>')
    }
    if source then table.insert(out, raw('<div class="bignum-s">' .. esc(source) .. '</div>')) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('phase') then
    local tag    = el.attributes['tag'] or ''
    local title  = el.attributes['title'] or ''
    local period = el.attributes['period']
    local active = attrget(el, 'active', 'false')
    local cls    = 'phase' .. (active == 'true' and ' active' or '')
    local out    = { raw('<div class="' .. cls .. '">') }
    if tag   ~= '' then table.insert(out, raw('<div class="phase-tag">'   .. esc(tag)   .. '</div>')) end
    if title ~= '' then table.insert(out, raw('<div class="phase-title">' .. esc(title) .. '</div>')) end
    if period       then table.insert(out, raw('<div class="phase-period">' .. esc(period) .. '</div>')) end
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('spec') then
    local title = attrget(el, 'title', '')
    local sub   = el.attributes['subtitle'] or el.attributes['sub'] or ''
    local out   = { raw('<div class="spec">') }
    if title ~= '' then table.insert(out, raw('<div class="spec-title">' .. esc(title) .. '</div>')) end
    if sub   ~= '' then table.insert(out, raw('<div class="spec-sub">'   .. esc(sub)   .. '</div>')) end
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('comparison-grid') or has('comparisongrid') then
    local out  = { raw('<div class="cg">') }
    local open = false
    for _, b in ipairs(el.content) do
      if b.t == 'Header' and b.level == 3 then
        if open then table.insert(out, raw('</div>')) end
        local hl    = b.classes:includes('highlight') or b.classes:includes('hl')
        local lbl   = b.attributes['label'] or ''
        local price = b.attributes['price'] or ''
        local name  = inlines_to_text(b.content)
        table.insert(out, raw('<div class="cc' .. (hl and ' hl' or '') .. '">'))
        if lbl ~= '' then table.insert(out, raw('<div class="cc-lbl">'  .. esc(lbl)  .. '</div>')) end
        table.insert(out, raw('<div class="cc-name">' .. esc(name) .. '</div>'))
        if price ~= '' then table.insert(out, raw('<div class="cc-price">' .. esc(price) .. '</div>')) end
        open = true
      elseif open then
        if b.t == 'Para' then
          table.insert(out, raw('<div class="cc-note">'))
          table.insert(out, b)
          table.insert(out, raw('</div>'))
        else
          table.insert(out, b)
        end
      end
    end
    if open then table.insert(out, raw('</div>')) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('team-grid') or has('teamgrid') then
    local out  = { raw('<div class="team-grid">') }
    local open = false
    for _, b in ipairs(el.content) do
      if b.t == 'Header' and b.level == 3 then
        if open then table.insert(out, raw('</div></div>')) end
        local name = inlines_to_text(b.content)
        local role = b.attributes['role'] or ''
        table.insert(out, raw('<div class="tc">'))
        table.insert(out, raw('<div class="tc-name">' .. esc(name) .. '</div>'))
        if role ~= '' then table.insert(out, raw('<div class="tc-role">' .. esc(role) .. '</div>')) end
        table.insert(out, raw('<div class="tc-bio">'))
        open = true
      elseif open then
        table.insert(out, b)
      end
    end
    if open then table.insert(out, raw('</div></div>')) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('product-cards') or has('productcards') then
    local out  = { raw('<div class="prod-grid">') }
    local open = false
    for _, b in ipairs(el.content) do
      if b.t == 'Header' and b.level == 3 then
        if open then table.insert(out, raw('</div>')) end
        local tag  = b.attributes['tag'] or ''
        local sub  = b.attributes['subtitle'] or b.attributes['sub'] or ''
        local name = inlines_to_text(b.content)
        table.insert(out, raw('<div class="prod">'))
        if tag ~= '' then table.insert(out, raw('<div class="prod-tag">' .. esc(tag) .. '</div>')) end
        table.insert(out, raw('<div class="prod-title">' .. esc(name) .. '</div>'))
        if sub ~= '' then table.insert(out, raw('<div class="prod-sub">' .. esc(sub) .. '</div>')) end
        open = true
      elseif open and b.t == 'BulletList' then
        for _, item in ipairs(b.content) do
          table.insert(out, raw('<div class="prod-row">' .. esc(inlines_to_text(item)) .. '</div>'))
        end
      elseif open then
        table.insert(out, b)
      end
    end
    if open then table.insert(out, raw('</div>')) end
    table.insert(out, raw('</div>'))
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

  elseif has('timeline') then
    -- Vertical chronological timeline.
    -- Each H3 inside the block is one event: the heading text is the date + title.
    -- Convention: "DD Mon YYYY — Event Title" — split on em/en-dash or plain dash.
    -- Body content (paragraphs, lists) after each H3 becomes the event description.
    -- The date is extracted from the heading and rendered in orange; the title in bold.
    local out = { raw('<div class="timeline">') }
    local in_event = false
    local em = string.char(226, 128, 148)
    local en = string.char(226, 128, 147)
    for _, b in ipairs(el.content) do
      if b.t == 'Header' and b.level == 3 then
        if in_event then table.insert(out, raw('</div></div>')) end
        local text = inlines_to_text(b.content)
        -- Split on em-dash, en-dash, or ' - ' to separate date from event title
        local date_part, title_part = nil, nil
        for _, sep in ipairs({ em, en, ' %- ' }) do
          local a, b2 = text:match([[^(.-)%s*]] .. sep .. [[%s*(.+)$]])
          if a then date_part = a; title_part = b2; break end
        end
        if not date_part then date_part = ''; title_part = text end
        table.insert(out, raw(
          '<div class="timeline-event">' ..
          '<div class="timeline-marker"><span class="timeline-dot"></span><span class="timeline-stem"></span></div>' ..
          '<div class="timeline-body">' ..
          '<div class="timeline-date">' .. esc(date_part) .. '</div>' ..
          '<div class="timeline-title">' .. esc(title_part) .. '</div>'
        ))
        in_event = true
      else
        table.insert(out, b)
      end
    end
    if in_event then table.insert(out, raw('</div></div>')) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('tensionbox') then
    local title = attrget(el, 'title', '')
    local out = { raw('<div class="tension-box">') }
    if title ~= '' then
      table.insert(out, raw('<div class="tension-title">' .. esc(title) .. '</div>'))
    end
    for _, b in ipairs(el.content) do table.insert(out, b) end
    table.insert(out, raw('</div>'))
    return out

  elseif has('roadmap') then
    -- 4-column roadmap table.
    -- Structure: each H3 inside the block becomes a row type:
    --   H3 with class .head  -> <tr class="rm-head"> with <th> cells
    --   H3 with class .period -> <tr class="rm-period"> with <td> cells
    --   H3 with class .tranche -> <tr class="rm-tranche"> with <td> cells
    --   Bullet list items -> <tr class="rm-item"> rows
    -- Any bare paragraph content is emitted after the table.
    --
    -- Simplified model: we parse each block linearly.
    -- H3 = new row group. BulletList after a tranche = item rows.
    local out = { raw('<table class="rm-table">') }
    local in_tranche = false

    local function cells_from_text(text)
      -- Split text on " | " to get individual cells
      local parts = {}
      for part in (text .. ' | '):gmatch('(.-)%s*|%s*') do
        table.insert(parts, esc(part))
      end
      return parts
    end

    for _, b in ipairs(el.content) do
      if b.t == 'Header' and b.level == 3 then
        local is_head    = b.classes:includes('head')
        local is_period  = b.classes:includes('period')
        local is_tranche = b.classes:includes('tranche')
        local text = inlines_to_text(b.content)
        local cells = cells_from_text(text)
        if is_head then
          in_tranche = false
          local row = '<tr class="rm-head"><th>' ..
            table.concat(cells, '</th><th>') .. '</th></tr>'
          table.insert(out, raw(row))
        elseif is_period then
          in_tranche = false
          local row = '<tr class="rm-period"><td>' ..
            table.concat(cells, '</td><td>') .. '</td></tr>'
          table.insert(out, raw(row))
        elseif is_tranche then
          in_tranche = true
          local row = '<tr class="rm-tranche"><td colspan="4">' .. esc(text) .. '</td></tr>'
          table.insert(out, raw(row))
        else
          -- Plain H3: treat like a tranche if no explicit class
          in_tranche = true
          local row = '<tr class="rm-tranche"><td colspan="4">' .. esc(text) .. '</td></tr>'
          table.insert(out, raw(row))
        end
      elseif b.t == 'BulletList' and in_tranche then
        for _, item in ipairs(b.content) do
          local item_text = inlines_to_text(item)
          local cells = cells_from_text(item_text)
          -- Pad to 4 cells
          while #cells < 4 do table.insert(cells, '') end
          local row = '<tr class="rm-item"><td>' ..
            table.concat(cells, '</td><td>') .. '</td></tr>'
          table.insert(out, raw(row))
        end
      else
        table.insert(out, b)
      end
    end
    table.insert(out, raw('</table>'))
    return out

  elseif has('financialtable') or has('financial-table') then
    -- Financial table with semantic row types.
    --
    -- Authors annotate the first cell of each row with a prefix:
    --   section:Label  -> <tr class="section"> — group header (caps divider)
    --   sub:Label      -> <tr class="sub">     — subtotal (pearl bg, bold, double rule)
    --   tot:Label      -> <tr class="tot">     — grand total (ink bg, white text)
    --   (no prefix)    -> plain <tr>
    --
    -- Number cells (cols 2+) get class="r" for right-align + tabular-nums.
    -- The first column gets class="lb" for bold label treatment on sub/tot rows.
    --
    -- The fenced div wraps a pipe table — pandoc processes the pipe table
    -- into a Table AST node which we walk here.
    local caption = attrget(el, 'caption', '')
    local out = {}
    if caption ~= '' then
      table.insert(out, raw('<p class="datatable-caption">' .. esc(caption) .. '</p>'))
    end
    table.insert(out, raw('<table class="financial-table">'))

    for _, b in ipairs(el.content) do
      if b.t == 'Table' then
        -- Emit thead from the table's head
        local head = b.head
        if head and head.rows and #head.rows > 0 then
          table.insert(out, raw('<thead>'))
          for _, row in ipairs(head.rows) do
            table.insert(out, raw('<tr>'))
            for i, cell in ipairs(row.cells) do
              local cls = i == 1 and '' or ' class="r"'
              local txt = pandoc.utils.stringify(cell.contents)
              table.insert(out, raw('<th' .. cls .. '>' .. esc(txt) .. '</th>'))
            end
            table.insert(out, raw('</tr>'))
          end
          table.insert(out, raw('</thead>'))
        end
        -- Emit tbody from table bodies
        table.insert(out, raw('<tbody>'))
        for _, body in ipairs(b.bodies) do
          for _, row in ipairs(body.body) do
            if #row.cells == 0 then goto continue_row end
            -- First cell determines row type
            local first_txt = pandoc.utils.stringify(row.cells[1].contents)
            local row_class = ''
            local label = first_txt
            local pfx = first_txt:match('^(section):(.+)$') or
                        first_txt:match('^(sub):(.+)$') or
                        first_txt:match('^(tot):(.+)$')
            if pfx then
              -- Extract prefix and real label
              local p, l = first_txt:match('^([^:]+):(.+)$')
              if p then
                row_class = p
                label = l:match('^%s*(.-)%s*$') -- trim
              end
            end
            local tr_open = row_class ~= '' and '<tr class="' .. row_class .. '">' or '<tr>'
            table.insert(out, raw(tr_open))
            -- First cell
            local first_cls = 'lb'
            table.insert(out, raw('<td class="' .. first_cls .. '">' .. esc(label) .. '</td>'))
            -- Remaining cells
            for i = 2, #row.cells do
              local txt = pandoc.utils.stringify(row.cells[i].contents)
              table.insert(out, raw('<td class="r">' .. esc(txt) .. '</td>'))
            end
            table.insert(out, raw('</tr>'))
            ::continue_row::
          end
        end
        table.insert(out, raw('</tbody>'))
      else
        -- Non-table content (e.g. paragraphs) emitted as-is
        table.insert(out, b)
      end
    end
    table.insert(out, raw('</table>'))
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
local BRAND_LOGO = nil

-- Called once before any Header; reads brand metadata set by the render pipeline.
function Meta(meta)
  if meta.docforge_no_autonumber then
    NO_AUTONUMBER = true
  end
  -- Capture brandlogo metadata for section opener pages
  if meta.brandlogo then
    BRAND_LOGO = pandoc.utils.stringify(meta.brandlogo)
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

  -- The section-opener wrapper carries page:section-opener (via brand CSS),
  -- which triggers @page section-opener to suppress running headers and apply
  -- the full padding-top breathing room. Without this wrapper the @page rule
  -- never fires — the root cause of missing ghost numeral, missing padding,
  -- and running headers appearing on section opener pages.
  local ghost = raw(
    '<div class="section-ghost" aria-hidden="true">' .. esc(num) .. '</div>')

  local eyebrow = raw(
    '<div class="section-number" data-index="' .. num .. '">' ..
    '<span class="section-number-num">' .. num .. '</span>' ..
    '<span class="section-number-sep">·</span>' ..
    '<span class="section-number-label">' .. esc(label) .. '</span>' ..
    '</div>')

  -- Emit the H1 as raw HTML so it stays inside the .section-opener block.
  -- When el (a native pandoc Header) is placed between raw open/close divs,
  -- WeasyPrint's block formatter can pull it out of the containing div context.
  -- Rendering it as raw HTML keeps the heading firmly inside the opener.
  local h1_id  = el.identifier ~= '' and (' id="' .. el.identifier .. '"') or ''
  local h1_cls = 'class="section-h1"'
  -- Preserve any data-nav-title attribute the heading carries
  local nav_attr = ''
  if el.attributes['data-nav-title'] then
    nav_attr = ' data-nav-title="' .. esc(el.attributes['data-nav-title']) .. '"'
  end
  local h1_text = esc(inlines_to_text(el.content))
  local heading = raw(
    '<h1' .. h1_id .. ' ' .. h1_cls .. nav_attr .. '>' .. h1_text .. '</h1>')

  -- Also set string-set on a hidden span so the running header still updates
  -- to the new section title even though the H1 is now raw HTML.
  local string_set = raw(
    '<span class="section-string-set" style="position:absolute;visibility:hidden;">' ..
    esc(inlines_to_text(el.content)) .. '</span>')

  -- Wrap the whole section opener (ghost + eyebrow + heading) in .section-opener
  -- so the CSS page: and padding-top rules have an element to land on.
  local open  = raw('<div class="section-opener">')
  local close = raw('</div>')

  -- If brandlogo is available, emit an img tag inside the section opener
  local logo_el = nil
  if BRAND_LOGO then
    logo_el = raw('<img class="section-opener-logo" src="' .. BRAND_LOGO .. '" alt="" aria-hidden="true">')
  end

  if logo_el then
    return { open, ghost, logo_el, string_set, eyebrow, heading, close }
  else
    return { open, ghost, string_set, eyebrow, heading, close }
  end
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

-- Wraps a struck section (Studio Phase 10) so the whole section reads as
-- cut, not just its heading.
--
-- Strike is stored as one attribute on the heading (Editor.tsx toggleStrike,
-- a deterministic text transform -- HANDOVER.md section 7b, decision 2), so
-- the source stays a single line edit. But a reader scanning the rendered
-- document needs the whole section to look struck, or a dimmed headline over
-- full-strength body text reads as a rendering bug, not a directive. This
-- pass runs server-side over the block tree, not the source, so the
-- attribute-per-heading storage model is unaffected -- only presentation
-- changes.
local function wrap_struck_sections(blocks)
  local out = {}
  local i = 1
  while i <= #blocks do
    local b = blocks[i]
    if b.t == 'Header' and b.classes:includes('struck') then
      local level = b.level
      local group = { b }
      local j = i + 1
      while j <= #blocks do
        local nb = blocks[j]
        if nb.t == 'Header' and nb.level <= level then break end
        table.insert(group, nb)
        j = j + 1
      end
      local wrap = pandoc.Div(group)
      wrap.classes:insert('struck-section')
      table.insert(out, wrap)
      i = j
    else
      table.insert(out, b)
      i = i + 1
    end
  end
  return out
end

-- Stamps top-level blocks with their originating source line.
-- Also injects the brand logo into .section-opener divs if brandlogo is available.
--
-- Document-level pass so doc.meta is readable before blocks are emitted.
function Pandoc(doc)
  -- Inject brand logo into section opener divs (if brandlogo metadata present)
  local logo_src = nil
  if doc.meta and doc.meta.brandlogo then
    logo_src = pandoc.utils.stringify(doc.meta.brandlogo)
  end

  local function inject_logo_into_blocks(blocks_list)
    if not logo_src then return blocks_list end
    local result = {}
    local i = 1
    while i <= #blocks_list do
      local b = blocks_list[i]
      -- Check if this RawBlock opens a section-opener div
      if b.t == 'RawBlock' and b.format == 'html' and
         b.text:match('class="section%-opener"') then
        -- Found opening <div class="section-opener">
        -- Next block should be the ghost, then we insert the logo img
        table.insert(result, b)  -- The <div class="section-opener"> opening
        i = i + 1
        -- Insert the ghost (next block)
        if i <= #blocks_list then
          table.insert(result, blocks_list[i])
          i = i + 1
        end
        -- Now inject the logo img
        local logo_img = pandoc.RawBlock('html',
          '<img class="section-opener-logo" src="' .. logo_src .. '" alt="" aria-hidden="true">')
        table.insert(result, logo_img)
      else
        table.insert(result, b)
        i = i + 1
      end
    end
    return result
  end

  local blocks = wrap_struck_sections(inject_logo_into_blocks(doc.blocks))

  if not doc.meta or not doc.meta.docforge_source_lines then
    return pandoc.Pandoc(blocks, doc.meta)
  end
  local cursor = 1
  local out = {}
  for _, b in ipairs(blocks) do
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
