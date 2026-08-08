export const DROPDOWN_OPEN_EVENT = 'autosub:dropdown-open';

export type DropdownId = object;

export function announceDropdownOpen(id: DropdownId) {
  window.dispatchEvent(new CustomEvent<DropdownId>(DROPDOWN_OPEN_EVENT, { detail: id }));
}

export function listenForOtherDropdowns(id: DropdownId, close: () => void) {
  const handler = (event: Event) => {
    if ((event as CustomEvent<DropdownId>).detail !== id) close();
  };
  window.addEventListener(DROPDOWN_OPEN_EVENT, handler);
  return () => window.removeEventListener(DROPDOWN_OPEN_EVENT, handler);
}
