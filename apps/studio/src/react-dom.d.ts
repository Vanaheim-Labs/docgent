// Minimal declaration to allow importing createPortal from react-dom.
// react-dom 19 ships its own types in newer @types/react-dom but the monorepo
// root has a peer-dep conflict — this local stub unblocks the build.
declare module "react-dom" {
  import type { ReactNode } from "react";
  export function createPortal(children: ReactNode, container: Element): ReactNode;
}
