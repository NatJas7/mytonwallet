import { Address } from '@ton/core';

import type {
  ApiBackendStakingState,
  ApiJettonStakingState,
  ApiLoyaltyType,
  ApiNetwork,
  ApiStakingCommonData,
  ApiStakingJettonPool,
  ApiStakingState,
} from '../../types';
import type { StakingPoolConfigUnpacked } from './contracts/JettonStaking/StakingPool';
import type { Nominator } from './contracts/NominatorPool';
import type {
  ApiCheckTransactionDraftResult,
  ApiSubmitTransferTonResult,
  TonTransferParams,
} from './types';
import {
  ApiLiquidUnstakeMode,
  ApiTransactionDraftError,
} from '../../types';

import {
  LIQUID_JETTON,
  LIQUID_POOL,
  TONCOIN,
  VALIDATION_PERIOD_MS,
} from '../../../config';
import { parseAccountId } from '../../../util/account';
import { bigintDivideToNumber, bigintMultiplyToNumber } from '../../../util/bigint';
import { fromDecimal } from '../../../util/decimals';
import calcJettonStakingApr from '../../../util/ton/calcJettonStakingApr';
import {
  buildJettonClaimPayload,
  buildJettonUnstakePayload,
  buildLiquidStakingDepositBody,
  buildLiquidStakingWithdrawBody,
  getJettonPoolStakeWallet,
  getTokenBalance,
  getTonClient,
  resolveTokenWalletAddress,
  toBase64Address,
  unpackDicts,
} from './util/tonCore';
import { StakeWallet } from './contracts/JettonStaking/StakeWallet';
import { StakingPool } from './contracts/JettonStaking/StakingPool';
import { NominatorPool } from './contracts/NominatorPool';
import { fetchStoredTonWallet } from '../../common/accounts';
import { callBackendGet } from '../../common/backend';
import { getAccountCache, getStakingCommonCache, updateAccountCache } from '../../common/cache';
import { getClientId } from '../../common/other';
import { getTokenByAddress, getTokenBySlug } from '../../common/tokens';
import { isKnownStakingPool } from '../../common/utils';
import { nftRepository } from '../../db';
import { STAKE_COMMENT, TON_GAS, UNSTAKE_COMMENT } from './constants';
import { checkTransactionDraft, submitTransfer } from './transactions';
import { isAddressInitialized } from './wallet';

export async function checkStakeDraft(accountId: string, amount: bigint, state: ApiStakingState) {
  let result: ApiCheckTransactionDraftResult;

  switch (state.type) {
    case 'nominators': {
      if (amount < TON_GAS.stakeNominators) {
        return { error: ApiTransactionDraftError.InvalidAmount };
      }

      result = await checkTransactionDraft({
        accountId,
        toAddress: state.pool,
        amount: amount + TON_GAS.stakeNominators,
        data: STAKE_COMMENT,
      });
      if ('fee' in result && result.fee) {
        result.fee = TON_GAS.stakeNominators + result.fee;
      }
      break;
    }
    case 'liquid': {
      result = await checkTransactionDraft({
        accountId,
        toAddress: LIQUID_POOL,
        amount: amount + TON_GAS.stakeLiquid,
        data: buildLiquidStakingDepositBody(),
      });
      if ('fee' in result && result.fee) {
        result.fee = TON_GAS.stakeLiquid + result.fee;
      }
      break;
    }
    case 'jetton': {
      const { tokenSlug, pool, period } = state;
      const { tokenAddress } = getTokenBySlug(tokenSlug);

      result = await checkTransactionDraft({
        accountId,
        toAddress: pool,
        tokenAddress,
        amount,
        data: StakingPool.stakePayload(period),
        forwardAmount: TON_GAS.stakeJettonsForward,
      });
      break;
    }
  }

  return result;
}

export async function checkUnstakeDraft(accountId: string, amount: bigint, state: ApiStakingState) {
  const { network } = parseAccountId(accountId);
  const { address } = await fetchStoredTonWallet(accountId);
  const commonData = getStakingCommonCache();

  let result: ApiCheckTransactionDraftResult;
  let tokenAmount: bigint | undefined;

  switch (state.type) {
    case 'nominators': {
      result = await checkTransactionDraft({
        accountId,
        toAddress: state.pool,
        amount: TON_GAS.unstakeNominators,
        data: UNSTAKE_COMMENT,
      });
      break;
    }
    case 'liquid': {
      if (amount > state.balance) {
        return { error: ApiTransactionDraftError.InsufficientBalance };
      } else if (amount === state.balance) {
        tokenAmount = state.tokenBalance;
      } else {
        tokenAmount = bigintDivideToNumber(amount, commonData.liquid.currentRate);
      }

      const params = await buildLiquidStakingWithdraw(network, address, tokenAmount);

      result = await checkTransactionDraft({
        accountId,
        toAddress: params.toAddress,
        amount: params.amount,
        data: params.payload,
      });
      break;
    }
    case 'jetton': {
      tokenAmount = amount;

      result = await checkTransactionDraft({
        accountId,
        toAddress: state.stakeWalletAddress,
        amount: TON_GAS.unstakeJettons,
        data: buildJettonUnstakePayload(amount, true),
      });
      break;
    }
  }

  return {
    ...result,
    type: state.type,
    tokenAmount,
  };
}

export async function submitStake(
  accountId: string,
  password: string,
  amount: bigint,
  state: ApiStakingState,
) {
  let result: ApiSubmitTransferTonResult;

  const { network } = parseAccountId(accountId);
  const { address } = await fetchStoredTonWallet(accountId);

  switch (state.type) {
    case 'nominators': {
      result = await submitTransfer({
        accountId,
        password,
        toAddress: toBase64Address(state.pool, true, network),
        amount: amount + TON_GAS.stakeNominators,
        data: STAKE_COMMENT,
      });
      break;
    }
    case 'liquid': {
      result = await submitTransfer({
        accountId,
        password,
        toAddress: LIQUID_POOL,
        amount: amount + TON_GAS.stakeLiquid,
        data: buildLiquidStakingDepositBody(),
      });
      break;
    }
    case 'jetton': {
      const { tokenSlug, pool, period } = state;
      const { tokenAddress } = getTokenBySlug(tokenSlug);

      result = await submitTransfer({
        accountId,
        password,
        toAddress: pool,
        tokenAddress,
        amount,
        data: StakingPool.stakePayload(period),
        forwardAmount: TON_GAS.stakeJettonsForward,
      });
      if (!('error' in result)) {
        result.toAddress = pool;
      }
      break;
    }
  }

  if (!('error' in result)) {
    updateAccountCache(accountId, address, { stakedAt: Date.now() });
  }

  return result;
}

export async function submitUnstake(
  accountId: string,
  password: string,
  amount: bigint,
  state: ApiStakingState,
) {
  const { network } = parseAccountId(accountId);
  const { address } = await fetchStoredTonWallet(accountId);

  let result: ApiSubmitTransferTonResult;

  switch (state.type) {
    case 'nominators': {
      result = await submitTransfer({
        accountId,
        password,
        toAddress: toBase64Address(state.pool, true, network),
        amount: TON_GAS.unstakeNominators,
        data: UNSTAKE_COMMENT,
      });
      break;
    }
    case 'liquid': {
      const mode = !state.instantAvailable
        ? ApiLiquidUnstakeMode.BestRate
        : ApiLiquidUnstakeMode.Default;

      const params = await buildLiquidStakingWithdraw(network, address, amount, mode);

      result = await submitTransfer({
        accountId,
        password,
        toAddress: params.toAddress,
        amount: params.amount,
        data: params.payload,
      });
      break;
    }
    case 'jetton': {
      result = await submitTransfer({
        accountId,
        password,
        toAddress: state.stakeWalletAddress,
        amount: TON_GAS.unstakeJettons,
        data: buildJettonUnstakePayload(amount, true),
      });
    }
  }

  return result;
}

export async function buildLiquidStakingWithdraw(
  network: ApiNetwork,
  address: string,
  amount: bigint,
  mode: ApiLiquidUnstakeMode = ApiLiquidUnstakeMode.Default,
): Promise<TonTransferParams> {
  const tokenWalletAddress = await resolveTokenWalletAddress(network, address, LIQUID_JETTON);

  const payload = buildLiquidStakingWithdrawBody({
    amount,
    responseAddress: address,
    fillOrKill: mode === ApiLiquidUnstakeMode.Instant,
    waitTillRoundEnd: mode === ApiLiquidUnstakeMode.BestRate,
  });

  return {
    amount: TON_GAS.unstakeLiquid,
    toAddress: tokenWalletAddress,
    payload,
  };
}

type StakingStateOptions = {
  accountId: string;
  backendState: ApiBackendStakingState;
  commonData: ApiStakingCommonData;
  address: string;
  loyaltyType?: ApiLoyaltyType;
  network: ApiNetwork;
};

export async function getStakingStates(
  accountId: string,
  commonData: ApiStakingCommonData,
  backendState: ApiBackendStakingState,
): Promise<ApiStakingState[]> {
  const { network } = parseAccountId(accountId);
  const { address } = await fetchStoredTonWallet(accountId);

  const {
    loyaltyType,
    shouldUseNominators,
    type: backendType,
  } = backendState;

  const options: StakingStateOptions = {
    accountId, backendState, commonData, address, loyaltyType, network,
  };

  const promises: Promise<ApiStakingState>[] = [buildLiquidState(options)];

  for (const poolConfig of commonData.jettonPools) {
    promises.push(buildJettonState(options, poolConfig));
  }

  if (shouldUseNominators || backendType === 'nominators') {
    promises.push(buildNominatorsState(options));
  }

  return Promise.all(promises);
}

async function buildLiquidState({
  accountId,
  address,
  backendState,
  commonData,
  loyaltyType,
}: StakingStateOptions): Promise<ApiStakingState> {
  const { currentRate, collection } = commonData.liquid;
  const tokenBalance = await getLiquidStakingTokenBalance(accountId);
  let unstakeAmount = 0n;

  if (collection) {
    const nfts = await nftRepository.find({
      accountId,
      collectionAddress: collection,
    });

    for (const nft of nfts ?? []) {
      const billAmount = nft.name?.match(/Bill for (?<amount>[\d.]+) Pool Jetton/)?.groups?.amount;
      if (billAmount) {
        unstakeAmount += fromDecimal(billAmount);
      }
    }
  }

  const accountCache = getAccountCache(accountId, address);
  const stakedAt = Math.max(accountCache.stakedAt ?? 0, backendState.stakedAt ?? 0);

  const isInstantUnstake = Date.now() - stakedAt > VALIDATION_PERIOD_MS;
  const liquidAvailable = isInstantUnstake ? commonData.liquid.available : 0n;

  let liquidApy = commonData.liquid.apy;
  if (loyaltyType && loyaltyType in commonData.liquid.loyaltyApy) {
    liquidApy = commonData.liquid.loyaltyApy[loyaltyType];
  }

  const fullTokenAmount = tokenBalance + unstakeAmount;
  const balance = bigintMultiplyToNumber(fullTokenAmount, currentRate);

  return {
    type: 'liquid',
    id: 'liquid',
    tokenSlug: TONCOIN.slug,
    pool: LIQUID_POOL,
    balance,
    annualYield: liquidApy,
    yieldType: 'APY',
    tokenBalance,
    isUnstakeRequested: unstakeAmount > 0n,
    unstakeRequestAmount: unstakeAmount,
    instantAvailable: liquidAvailable,
  };
}

async function buildNominatorsState({
  network,
  address,
  backendState,
  commonData,
}: StakingStateOptions): Promise<ApiStakingState> {
  const balance = backendState.balance;
  const { address: pool, apy } = backendState.nominatorsPool;

  const isPrevRoundUnlocked = Date.now() > commonData.prevRound.unlock;
  const start = isPrevRoundUnlocked ? commonData.round.start : commonData.prevRound.start;
  const end = isPrevRoundUnlocked ? commonData.round.unlock : commonData.prevRound.unlock;

  let currentNominator: Nominator | undefined;

  if (backendState.type === 'nominators') {
    const nominatorPool = getTonClient(network).open(new NominatorPool(Address.parse(pool)));
    const nominators = await nominatorPool.getListNominators();
    const addressObject = Address.parse(address);
    currentNominator = nominators.find((n) => n.address.equals(addressObject));
  }

  return {
    type: 'nominators',
    id: 'nominators',
    tokenSlug: TONCOIN.slug,
    balance: currentNominator ? balance : 0n,
    annualYield: apy,
    yieldType: 'APY',
    pool,
    start,
    end,
    pendingDepositAmount: currentNominator?.pendingDepositAmount ?? 0n,
    isUnstakeRequested: currentNominator?.withdrawRequested ?? false,
  };
}

async function buildJettonState(
  options: StakingStateOptions,
  poolConfig: ApiStakingJettonPool,
): Promise<ApiJettonStakingState> {
  const { network } = options;

  // common
  const {
    pool: poolAddress,
    token: tokenAddress,
  } = poolConfig;

  const { decimals, slug: tokenSlug } = getTokenByAddress(tokenAddress)!;

  const tonClient = getTonClient(network);
  const pool = tonClient.open(StakingPool.createFromAddress(Address.parse(poolAddress)));

  // pool
  const poolData = await pool.getStorageData();
  const { tvl, rewardJettons } = unpackDicts(poolData) as StakingPoolConfigUnpacked;
  const { rewardsDeposits } = Object.values(rewardJettons!)[0];
  const now = Math.floor(Date.now() / 1000);

  let dailyReward: bigint = 0n;
  for (const { startTime, endTime, distributionSpeed } of Object.values(rewardsDeposits)) {
    if (startTime < now && endTime > now) {
      dailyReward += distributionSpeed;
    }
  }

  const apr = calcJettonStakingApr({ tvl, dailyReward, decimals });

  // wallet
  const { address } = options;
  const periodConfig = poolConfig.periods[0];

  const stakeWallet = await getJettonPoolStakeWallet(network, poolAddress, periodConfig.period, address);
  const walletData = await stakeWallet.getStorageData().catch(() => undefined);

  let unclaimedRewards = 0n;
  let balance = 0n;
  let poolWallets: string[] | undefined;

  if (walletData) {
    const poolWalletAddress = await resolveTokenWalletAddress(network, poolAddress, tokenAddress);
    const rewards = walletData && StakeWallet.getAvailableRewards(walletData, poolData);
    unclaimedRewards = (rewards && rewards[poolWalletAddress]) ?? 0n;
    balance = walletData.jettonBalance;
    poolWallets = Object.keys(rewards);
  }

  const state: ApiJettonStakingState = {
    type: 'jetton',
    id: poolAddress,
    pool: poolAddress,
    tokenAddress,
    tokenSlug,
    annualYield: apr,
    yieldType: 'APR',
    balance,
    unclaimedRewards,
    poolWallets,
    stakeWalletAddress: toBase64Address(stakeWallet.address, true),
    tokenAmount: 0n,
    tvl,
    dailyReward,
    period: periodConfig.period,
  };

  return state;
}

async function getLiquidStakingTokenBalance(accountId: string) {
  const { network } = parseAccountId(accountId);
  if (network !== 'mainnet') {
    return 0n;
  }

  const { address } = await fetchStoredTonWallet(accountId);
  const walletAddress = await resolveTokenWalletAddress(network, address, LIQUID_JETTON);
  const isInitialized = await isAddressInitialized(network, walletAddress);

  if (!isInitialized) {
    return 0n;
  }

  return getTokenBalance(network, walletAddress);
}

export async function getBackendStakingState(accountId: string): Promise<ApiBackendStakingState> {
  const { address } = await fetchStoredTonWallet(accountId);
  const state = await fetchBackendStakingState(address);
  return {
    ...state,
    nominatorsPool: {
      ...state.nominatorsPool,
      start: state.nominatorsPool.start * 1000,
      end: state.nominatorsPool.end * 1000,
    },
  };
}

export async function fetchBackendStakingState(address: string): Promise<ApiBackendStakingState> {
  const clientId = await getClientId();
  const stakingState = await callBackendGet(`/staking/state/${address}`, undefined, {
    'X-App-ClientID': clientId,
  });

  stakingState.balance = fromDecimal(stakingState.balance);
  stakingState.totalProfit = fromDecimal(stakingState.totalProfit);

  if (!isKnownStakingPool(stakingState.nominatorsPool.address)) {
    throw Error('Unexpected pool address, likely a malicious activity');
  }

  return stakingState;
}

export function submitStakingClaim(
  accountId: string,
  password: string,
  state: ApiJettonStakingState,
) {
  return submitTransfer({
    accountId,
    password,
    toAddress: state.stakeWalletAddress,
    amount: TON_GAS.claimJettons,
    data: buildJettonClaimPayload(state.poolWallets!),
  });
}
