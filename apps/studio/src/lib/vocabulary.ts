/**
 * Vocabulary bridge.
 *
 * The registry in packages/vocabulary is the single source of truth for what
 * an author may write. Studio must not keep its own copy — a second list is a
 * second thing to drift. We parse the same YAML at request time and hand the
 * client a serialisable shape for autocomplete and inline validation.
 */
import fs from "node:fs";
import path from "node:path";

export type AttrSpec = {
  type: string;
  values: string[] | null;
  required: boolean;
  default?: string;
};

export type BlockSpec = {
  id: string;
  description: string;
  attrs: Record<string, AttrSpec>;
};

export type Vocabulary = {
  blocks: BlockSpec[];
  inlineIds: string[];
  frontmatter: {
    required: string[];
    optional: string[];
    enums: Record<string, string[]>;
  };
};

let cached: Vocabulary | null = null;

function registryPath() {
  // Vercel bundles the app from apps/studio; the registry lives above it.
  const candidates = [
    path.join(process.cwd(), "..", "..", "packages", "vocabulary", "vocabulary.yaml"),
    path.join(process.cwd(), "packages", "vocabulary", "vocabulary.yaml"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("vocabulary.yaml not found");
}

export function loadVocabulary(): Vocabulary {
  if (cached) return cached;

  const raw = fs.readFileSync(registryPath(), "utf8");
  const lines = raw.split("\n");

  const blocks: BlockSpec[] = [];
  const inlineIds: string[] = [];
  const frontmatter = {
    required: [] as string[],
    optional: [] as string[],
    enums: {} as Record<string, string[]>,
  };

  let section: string | null = null;
  let current: BlockSpec | null = null;
  let inAttrs = false;
  let fmSub: string | null = null;

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.match(/^\s*/)![0].length;
    const line = rawLine.trim();

    if (indent === 0) {
      if (line === "blocks:") { section = "blocks"; current = null; inAttrs = false; continue; }
      if (line === "inlines:") { section = "inlines"; current = null; inAttrs = false; continue; }
      if (line === "frontmatter:") { section = "frontmatter"; fmSub = null; continue; }
      section = null;
      continue;
    }

    if (section === "blocks") {
      const idm = line.match(/^-\s+id:\s*(\S+)/);
      if (idm && indent === 2) {
        current = { id: idm[1], description: "", attrs: {} };
        blocks.push(current);
        inAttrs = false;
        continue;
      }
      if (!current) continue;
      if (indent === 4) {
        if (line === "attrs:") { inAttrs = true; continue; }
        inAttrs = false;
        const dm = line.match(/^description:\s*(.*)$/);
        if (dm) current.description = dm[1].replace(/^["']|["']$/g, "");
        continue;
      }
      if (inAttrs && indent === 6) {
        const am = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*\{(.*)\}\s*$/);
        if (am) {
          const [, name, body] = am;
          const spec: AttrSpec = { type: "string", values: null, required: false };
          const t = body.match(/type:\s*([A-Za-z]+)/);
          if (t) spec.type = t[1];
          const v = body.match(/values:\s*\[([^\]]*)\]/);
          if (v) spec.values = v[1].split(",").map((s) => s.trim()).filter(Boolean);
          const r = body.match(/required:\s*(true|false)/);
          if (r) spec.required = r[1] === "true";
          const d = body.match(/default:\s*([^,}]+)/);
          if (d) spec.default = d[1].trim();
          current.attrs[name] = spec;
        }
        continue;
      }
    }

    if (section === "inlines") {
      const idm = line.match(/^-\s+id:\s*(\S+)/);
      if (idm && indent === 2) inlineIds.push(idm[1]);
      continue;
    }

    if (section === "frontmatter") {
      const req = line.match(/^required:\s*\[([^\]]*)\]/);
      if (req) {
        frontmatter.required = req[1].split(",").map((s) => s.trim()).filter(Boolean);
        fmSub = null;
        continue;
      }
      if (line === "optional:") { fmSub = "optional"; continue; }
      if (line === "enums:") { fmSub = "enums"; continue; }
      if (fmSub === "optional") {
        const im = line.match(/^-\s*(\S+)/);
        if (im) frontmatter.optional.push(im[1]);
        continue;
      }
      if (fmSub === "enums") {
        const em = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*\[([^\]]*)\]/);
        if (em) {
          frontmatter.enums[em[1]] = em[2].split(",").map((s) => s.trim()).filter(Boolean);
        }
        continue;
      }
    }
  }

  cached = { blocks, inlineIds, frontmatter };
  return cached;
}
