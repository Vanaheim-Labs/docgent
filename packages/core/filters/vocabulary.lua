-- DocForge vocabulary filter.
-- Translates fenced divs into semantic HTML with data-attributes for CSS.

local function attrget(el, key, default)
  return el.attributes[key] or default
end

local function raw(s) return pandoc.RawBlock('html', s) end

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

-- Auto-number top-level headings unless explicitly opted out
function Header(el)
  if el.level <= 2 and not el.classes:includes('unnumbered') then
    el.classes:insert('numbered')
  end
  return el
end
