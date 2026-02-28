import type { GlobalState } from '../types';

import { updateCurrentAccountId } from './misc';
import { clearCurrentSwap } from './swap';
import { clearCurrentTransfer } from './transfer';

export function updateCurrentSignature(global: GlobalState, update: Partial<GlobalState['currentSignature']>) {
  return {
    ...global,
    currentSignature: {
      ...global.currentSignature,
      ...update,
    },
  } as GlobalState;
}

export function clearCurrentSignature(global: GlobalState) {
  return {
    ...global,
    currentSignature: undefined,
  };
}

export function switchAccountAndClearGlobal(global: GlobalState, accountId: string) {
  let newGlobal = updateCurrentAccountId(global, accountId);
  newGlobal = clearCurrentTransfer(newGlobal);

  return clearCurrentSwap(newGlobal);
}
