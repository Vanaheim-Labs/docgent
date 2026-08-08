/**
 * Semantic diff bridge.
 *
 * Kept in src/lib so the relative path to the monorepo package is shallow and
 * stable. Route folders nest arbitrarily deep, and a '../../../../../..' chain
 * breaks the moment a route moves.
 */
import { semanticDiff, summarise } from "../../../../packages/git-store/src/semantic-diff.mjs";

export type Change = {
  type: string;
  detail: string;
  section?: string;
  block?: string;
  key?: string;
  before?: string;
  after?: string;
};

export type DiffResult = {
  changes: Change[];
  summary: Record<string, number>;
};

export function diffDocuments(before: string, after: string): DiffResult {
  return semanticDiff(before, after) as DiffResult;
}

export function diffHeadline(diff: DiffResult): string {
  return summarise(diff) as string;
}
