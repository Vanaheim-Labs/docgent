// History API fallback for browsers without the cancellable Navigation API.
// Add only our own index; preserve Next's opaque router state verbatim.
const INDEX = "__docgentHistoryIndex";
export const BEFORE_TRAVERSE = "docgent:before-traverse";
export function installTraversalFallback() {
  if ((window as Window & { navigation?: EventTarget }).navigation) return () => {};
  const push = history.pushState, replace = history.replaceState;
  let current = Number.isInteger(history.state?.[INDEX]) ? history.state[INDEX] as number : 0;
  let returning = false;
  replace.call(history, { ...history.state, [INDEX]: current }, "");
  const wrappedPush: History["pushState"] = function(this: History, data, unused, url) {
    push.call(this, { ...data, [INDEX]: current + 1 }, unused, url);
    current++;
  };
  const wrappedReplace: History["replaceState"] = function(this: History, data, unused, url) {
    replace.call(this, { ...data, [INDEX]: current }, unused, url);
  };
  history.pushState = wrappedPush;
  history.replaceState = wrappedReplace;
  const traverse = (event: PopStateEvent) => {
    if (returning) { returning = false; event.stopImmediatePropagation(); return; }
    const destination = event.state?.[INDEX];
    // Entries predating this document aren't indexed; native cross-document
    // beforeunload and identity-scoped recovery still protect those exits.
    if (!Number.isInteger(destination)) return;
    const guard = new Event(BEFORE_TRAVERSE, { cancelable: true });
    if (!window.dispatchEvent(guard)) {
      event.stopImmediatePropagation();
      const delta = current - destination;
      if (delta) { returning = true; history.go(delta); }
    } else current = destination;
  };
  window.addEventListener("popstate", traverse, true);
  return () => {
    window.removeEventListener("popstate", traverse, true);
    if (history.pushState === wrappedPush) history.pushState = push;
    if (history.replaceState === wrappedReplace) history.replaceState = replace;
  };
}
