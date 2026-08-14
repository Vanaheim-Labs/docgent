/**
 * Single source of truth for YAML parsing across Docgent.
 *
 * Previously four hand-rolled parsers existed (core/render.mjs,
 * vocabulary/validate.mjs, git-store/documents.mjs, git-store/semantic-diff.mjs).
 * They disagreed: the renderer coerced booleans and numbers and supported
 * nested maps, while the validator and git-store returned flat strings only.
 * That meant a document could validate against one reading of its frontmatter
 * and render against another. One parser removes that whole class of bug.
 */
import YAML from "yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Parses a YAML document into a plain object. Returns {} for empty input. */
export function parseYaml(text) {
  if (text == null || String(text).trim() === "") return {};
  const parsed = YAML.parse(String(text));
  return parsed == null || typeof parsed !== "object" ? {} : parsed;
}

/**
 * Splits a markdown source into its frontmatter object and body.
 * Returns { data, body, found }. Never throws on a missing block; a malformed
 * block throws, because silently rendering a document whose metadata failed to
 * parse is worse than failing loudly.
 */
export function splitFrontmatter(src) {
  const text = String(src ?? "");
  const m = text.match(FRONTMATTER_RE);
  if (!m) return { data: {}, body: text, found: false };
  return {
    data: parseYaml(m[1]),
    body: text.slice(m[0].length),
    found: true,
  };
}

/** Frontmatter object for a markdown source. {} when absent. */
export function parseFrontmatter(src) {
  return splitFrontmatter(src).data;
}
