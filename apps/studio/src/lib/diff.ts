/**
 * Diff bridges.
 *
 * Kept in src/lib so the relative path to the monorepo package is shallow and
 * stable. Route folders nest arbitrarily deep, and a '../../../../../..' chain
 * breaks the moment a route moves.
 *
 * Two differs, deliberately. The semantic differ answers "what changed in
 * document terms"; the unified differ answers "show me the text". A reviewer
 * signing off wants the first, an author checking their own edit wants the
 * second, and collapsing them into one view served neither.
 */
import { semanticDiff, summarise } from "../../../../packages/git-store/src/semantic-diff.mjs";
import { unifiedDiff } from "../../../../packages/git-store/src/unified-diff.mjs";

/** A word-level run inside a reworded change. */
export type ChangeWordRun = { op: "same" | "add" | "remove"; text: string };

export type Change = {
  type: string;
  detail: string;
  section?: string;
  block?: string;
  key?: string;
  before?: string;
  after?: string;
  /** Present when the differ paired a removal with its matching addition —
   *  a reworded line, rendered as inline strike/insert rather than a
   *  wholesale replacement. */
  words?: ChangeWordRun[];
  /** Heading depth either side of a re-level or rename. */
  beforeLevel?: number;
  afterLevel?: number;
};

export type DiffResult = {
  changes: Change[];
  summary: Record<string, number>;
};

/** A word-level run inside a changed line. */
export type WordRun = { op: "same" | "add" | "remove"; text: string };

/** One rendered row of a unified diff. */
export type DiffRow = {
  op: "same" | "add" | "remove" | "change";
  leftNo: number | null;
  rightNo: number | null;
  leftText?: string;
  rightText?: string;
  leftWords?: WordRun[];
  rightWords?: WordRun[];
};

export type DiffHunk = {
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
  startIndex: number;
  endIndex: number;
  heading: string;
  rows: DiffRow[];
};

export type UnifiedDiffResult = {
  additions: number;
  deletions: number;
  totalLines: number;
  hunks: DiffHunk[];
  rows: DiffRow[];
};

export function diffDocuments(before: string, after: string): DiffResult {
  return semanticDiff(before, after) as DiffResult;
}

export function diffHeadline(diff: DiffResult): string {
  return summarise(diff) as string;
}

export function diffUnified(
  before: string,
  after: string,
  context = 3
): UnifiedDiffResult {
  return unifiedDiff(before, after, { context }) as UnifiedDiffResult;
}
