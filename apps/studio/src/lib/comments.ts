export type DocComment = {
  id: string;
  author: string;
  resolved: boolean;
  body: string;
  /** 1-based line number of the opening %%[ line in the source */
  line: number;
};

/**
 * Parse all %%[...] ... %% block comments from a Markdown source string.
 * Returns them in document order.
 */
export function parseComments(source: string): DocComment[] {
  const lines = source.split('\n');
  const comments: DocComment[] = [];
  let current: Partial<DocComment> | null = null;
  let bodyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();

    if (!current && stripped.startsWith('%%[')) {
      // Parse attrs from %%[author="X" id="Y" resolved="true"]
      const attrStr = stripped.slice(3, stripped.endsWith(']') ? stripped.length - 1 : stripped.length);
      const get = (key: string): string => {
        const m = attrStr.match(new RegExp(`${key}="([^"]*?)"`));
        return m ? m[1] : '';
      };
      current = {
        id: get('id') || `c${i}`,
        author: get('author') || 'unknown',
        resolved: get('resolved') === 'true',
        line: i + 1,
      };
      bodyLines = [];
      continue;
    }

    if (current) {
      if (stripped === '%%') {
        comments.push({
          ...current,
          body: bodyLines.join('\n').trim(),
        } as DocComment);
        current = null;
        bodyLines = [];
      } else {
        bodyLines.push(lines[i]);
      }
    }
  }

  return comments;
}

/**
 * Update a comment's resolved state in the source string.
 * Finds the %%[ block with the matching id and rewrites its resolved attr.
 */
export function setCommentResolved(source: string, id: string, resolved: boolean): string {
  const lines = source.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith('%%[') && stripped.includes(`id="${id}"`)) {
      // Toggle/set resolved attr
      let newLine = line;
      if (line.includes('resolved=')) {
        newLine = line.replace(/resolved="[^"]*"/, `resolved="${resolved}"`);
      } else {
        // Insert before closing ]
        newLine = line.replace(']', ` resolved="${resolved}"]`);
      }
      out.push(newLine);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/**
 * Insert a new comment into the source after a given 1-based line number.
 */
export function insertComment(source: string, afterLine: number, comment: Omit<DocComment, 'line'>): string {
  const lines = source.split('\n');
  const block = [
    `%%[author="${comment.author}" id="${comment.id}" resolved="false"]`,
    comment.body,
    '%%',
    '',
  ];
  lines.splice(afterLine, 0, ...block);
  return lines.join('\n');
}
