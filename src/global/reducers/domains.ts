import type { GlobalState } from '../types';

import { replaceActivityId } from '../helpers/misc';

export function updateCurrentDomainRenewal(
  global: GlobalState,
  update: Partial<GlobalState['currentDomainRenewal']>,
): GlobalState {
  return {
    ...global,
    currentDomainRenewal: {
      ...global.currentDomainRenewal,
      ...update,
    },
  };
}

export function updateCurrentDomainLinking(
  global: GlobalState,
  update: Partial<GlobalState['currentDomainLinking']>,
): GlobalState {
  return {
    ...global,
    currentDomainLinking: {
      ...global.currentDomainLinking,
      ...update,
    },
  };
}

/** replaceMap: keys - old (removed) activity ids, value - new (added) activity ids */
export function replaceCurrentDomainRenewalId(global: GlobalState, replaceMap: Record<string, string>) {
  return updateCurrentDomainRenewal(global, {
    txId: replaceActivityId(global.currentDomainRenewal.txId, replaceMap),
  });
}

/** replaceMap: keys - old (removed) activity ids, value - new (added) activity ids */
export function replaceCurrentDomainLinkingId(global: GlobalState, replaceMap: Record<string, string>) {
  return updateCurrentDomainLinking(global, {
    txId: replaceActivityId(global.currentDomainLinking.txId, replaceMap),
  });
}
