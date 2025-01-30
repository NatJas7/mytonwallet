import { Dialog } from 'native-dialog';
import React, {
  memo, type TeactNode, useEffect, useMemo, useState,
} from '../../lib/teact/teact';
import { getActions, withGlobal } from '../../global';

import type { ApiStakingState, ApiTokenWithPrice } from '../../api/types';
import type { UserToken } from '../../global/types';
import { StakingState } from '../../global/types';

import {
  ANIMATED_STICKER_MIDDLE_SIZE_PX,
  ANIMATED_STICKER_SMALL_SIZE_PX,
  JVAULT_URL,
  NOMINATORS_STAKING_MIN_AMOUNT,
  SHORT_FRACTION_DIGITS,
  STAKING_MIN_AMOUNT,
  TONCOIN,
} from '../../config';
import renderText from '../../global/helpers/renderText';
import { buildStakingDropdownItems } from '../../global/helpers/staking';
import {
  selectAccountStakingState,
  selectAccountStakingStates,
  selectCurrentAccountState,
  selectCurrentAccountTokens,
} from '../../global/selectors';
import { bigintMax } from '../../util/bigint';
import buildClassName from '../../util/buildClassName';
import { vibrate } from '../../util/capacitor';
import { fromDecimal, toBig, toDecimal } from '../../util/decimals';
import { getTonStakingFees } from '../../util/fee/getTonOperationFees';
import { formatCurrency } from '../../util/formatNumber';
import { throttle } from '../../util/schedulers';
import { buildUserToken, getIsNativeToken, getNativeToken } from '../../util/tokens';
import calcJettonStakingApr from '../../util/ton/calcJettonStakingApr';
import { IS_DELEGATED_BOTTOM_SHEET } from '../../util/windowEnvironment';
import { ANIMATED_STICKERS_PATHS } from '../ui/helpers/animatedAssets';

import useFlag from '../../hooks/useFlag';
import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useSyncEffect from '../../hooks/useSyncEffect';

import AnimatedIconWithPreview from '../ui/AnimatedIconWithPreview';
import Button from '../ui/Button';
import Dropdown from '../ui/Dropdown';
import Fee from '../ui/Fee';
import Modal from '../ui/Modal';
import RichNumberField from '../ui/RichNumberField';
import RichNumberInput from '../ui/RichNumberInput';
import Transition from '../ui/Transition';

import modalStyles from '../ui/Modal.module.scss';
import styles from './Staking.module.scss';

interface OwnProps {
  isActive?: boolean;
  isStatic?: boolean;
}

interface StateProps {
  isLoading?: boolean;
  apiError?: string;
  tokens?: UserToken[];
  tokenBySlug?: Record<string, ApiTokenWithPrice>;
  fee?: bigint;
  stakingState?: ApiStakingState;
  states?: ApiStakingState[];
  shouldUseNominators?: boolean;
}

const ACTIVE_STATES = new Set([StakingState.StakeInitial, StakingState.None]);

const runThrottled = throttle((cb) => cb(), 1500, true);

function StakingInitial({
  isActive,
  isStatic,
  isLoading,
  apiError,
  tokens,
  tokenBySlug,
  fee,
  stakingState,
  states,
  shouldUseNominators,
}: OwnProps & StateProps) {
  const {
    submitStakingInitial, fetchStakingFee, cancelStaking, changeCurrentStaking,
  } = getActions();

  const lang = useLang();

  const [isSafeInfoModalOpen, openSafeInfoModal, closeSafeInfoModal] = useFlag();
  const [amount, setAmount] = useState<bigint | undefined>();
  const [isIncorrectAmount, setIsIncorrectAmount] = useState<boolean>(false);
  const [isInsufficientBalance, setIsInsufficientBalance] = useState<boolean>(false);
  const [isInsufficientFee, setIsInsufficientFee] = useState(false);
  const [isBelowMinimumAmount, setIsBelowMinimumAmount] = useState(false);
  const [shouldUseAllBalance, setShouldUseAllBalance] = useState<boolean>(false);

  const {
    type: stakingType,
    tokenSlug,
    balance: stakingBalance = 0n,
  } = stakingState ?? {};

  const token: UserToken | undefined = useMemo(() => {
    if (!tokenSlug || !tokens || !tokenBySlug) return undefined;
    let userToken = tokens.find(({ slug }) => slug === tokenSlug);
    if (!userToken && tokenSlug in tokenBySlug) {
      userToken = buildUserToken(tokenBySlug[tokenSlug]);
    }
    return userToken;
  }, [tokenSlug, tokens, tokenBySlug]);
  const { amount: balance = 0n, symbol, decimals = TONCOIN.decimals } = token ?? {};

  let { annualYield = 0 } = stakingState ?? {};
  if (stakingState?.type === 'jetton' && amount) {
    annualYield = calcJettonStakingApr({
      tvl: stakingState.tvl + amount,
      dailyReward: stakingState.dailyReward,
      decimals,
    });
  }

  const isNativeToken = getIsNativeToken(token?.slug);
  const nativeToken = useMemo(() => {
    if (!tokens || !token) return undefined;
    if (isNativeToken) return token;
    const nativeSlug = getNativeToken(token.chain).slug;
    return tokens.find(({ slug }) => slug === nativeSlug);
  }, [tokens, token, isNativeToken]);
  const nativeBalance = nativeToken?.amount ?? 0n;

  const hasAmountError = Boolean(isInsufficientBalance || apiError);
  const minAmount = stakingType === 'nominators' ? NOMINATORS_STAKING_MIN_AMOUNT : STAKING_MIN_AMOUNT;

  const { gas: networkFee, real: realFee } = getTonStakingFees(stakingState?.type).stake;

  const nativeAmount = isNativeToken && amount ? amount + networkFee : networkFee;
  const doubleNetworkFee = networkFee * 2n;
  const shouldLeaveForUnstake = isNativeToken && balance >= doubleNetworkFee;
  const maxAmount = (() => {
    let value = balance;
    if (isNativeToken && value) {
      value -= shouldLeaveForUnstake ? doubleNetworkFee : networkFee;
    }
    return bigintMax(0n, value);
  })();

  const validateAndSetAmount = useLastCallback((newAmount: bigint | undefined, noReset = false) => {
    if (!noReset) {
      setShouldUseAllBalance(false);
      setIsIncorrectAmount(false);
      setIsInsufficientBalance(false);
      setIsBelowMinimumAmount(false);
      setIsInsufficientFee(false);
    }

    if (newAmount === undefined) {
      setAmount(undefined);
      return;
    }

    if (Number.isNaN(newAmount) || newAmount < 0) {
      setIsIncorrectAmount(true);
      return;
    }

    if (newAmount < minAmount) {
      setIsBelowMinimumAmount(true);
    } else if (!maxAmount || newAmount > balance) {
      setIsInsufficientBalance(true);
    } else if (nativeBalance < networkFee || (isNativeToken && nativeAmount > balance)) {
      setIsInsufficientFee(true);
    }

    setAmount(newAmount);
  });

  const dropDownItems = useMemo(() => {
    if (!tokenBySlug || !states) {
      return [];
    }

    return buildStakingDropdownItems({ tokenBySlug, states, shouldUseNominators });
  }, [tokenBySlug, states, shouldUseNominators]);

  useEffect(() => {
    if (shouldUseAllBalance && maxAmount) {
      const newAmount = maxAmount;

      validateAndSetAmount(newAmount, true);
    } else {
      validateAndSetAmount(amount, true);
    }
  }, [amount, fee, shouldUseAllBalance, validateAndSetAmount, maxAmount]);

  useEffect(() => {
    if (!amount) {
      return;
    }

    runThrottled(() => {
      fetchStakingFee({
        amount,
      });
    });
  }, [amount, fetchStakingFee]);

  useSyncEffect(() => {
    if (!IS_DELEGATED_BOTTOM_SHEET) return;

    if (isSafeInfoModalOpen) {
      const text = stakingState && stakingState.type === 'jetton'
        ? [
          // We use `replace` instead of `lang` argument to avoid JSX output
          `${lang('$safe_staking_description_jetton1').replace('%jvault_link%', 'JVault')}`,
          `${lang('$safe_staking_description_jetton2')}`,
        ]
        : [
          `1. ${lang('$safe_staking_description1')}`,
          `2. ${lang('$safe_staking_description2')}`,
          `3. ${lang('$safe_staking_description3')}`,
        ];

      Dialog.alert({
        title: lang('Why is staking safe?'),
        message: text.join('\n\n').replace(/\*\*/g, ''),
      })
        .then(closeSafeInfoModal);
    }
  }, [isSafeInfoModalOpen, lang, stakingState]);

  const handleMaxAmountClick = useLastCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!maxAmount) {
      return;
    }

    vibrate();

    setShouldUseAllBalance(true);
  });

  const canSubmit = amount
    && maxAmount
    && !isIncorrectAmount
    && !isBelowMinimumAmount
    && !isInsufficientFee
    && !isInsufficientBalance;

  const handleSubmit = useLastCallback((e) => {
    e.preventDefault();

    if (!canSubmit) {
      return;
    }

    vibrate();

    submitStakingInitial({ amount });
  });

  const handleAmountChange = useLastCallback((stringValue?: string) => {
    const value = stringValue ? fromDecimal(stringValue, decimals) : undefined;
    validateAndSetAmount(value);
  });

  function getError() {
    if (isInsufficientBalance) {
      return lang('Insufficient balance');
    }

    if (isInsufficientFee) {
      return lang('$insufficient_fee', { fee: formatCurrency(toDecimal(networkFee), nativeToken?.symbol ?? '') });
    }

    if (isBelowMinimumAmount) {
      return lang('$min_value', {
        value: (
          <span className={styles.minAmountValue}>
            {formatCurrency(toDecimal(minAmount), symbol ?? '')}
          </span>
        ),
      });
    }

    return apiError ? lang(apiError) : undefined;
  }

  function renderTopRight() {
    if (!symbol) return undefined;

    const hasBalance = !!token;
    const balanceButton = lang('$max_balance', {
      balance: (
        <div
          role="button"
          tabIndex={0}
          className={styles.balanceLink}
          onClick={handleMaxAmountClick}
        >
          {hasBalance ? formatCurrency(toDecimal(maxAmount, decimals), symbol) : lang('Loading...')}
        </div>
      ),
    });

    return (
      <Transition
        className={buildClassName(styles.amountTopRight, isStatic && styles.amountTopRight_static)}
        slideClassName={styles.amountTopRight_slide}
        name="fade"
        activeKey={0}
      >
        <div className={styles.balanceContainer}>
          <span className={styles.balance}>
            {balanceButton}
          </span>
        </div>
      </Transition>
    );
  }

  function renderBottomRight() {
    const error = getError();

    const activeKey = isInsufficientBalance ? 0
      : isInsufficientFee ? 1
        : isBelowMinimumAmount ? 2
          : apiError ? 3
            : !stakingBalance && !hasAmountError ? 4
              : 5;

    let content: string | TeactNode[] | React.JSX.Element = ' ';

    if (error) {
      content = (
        <span className={styles.balanceError}>{error}</span>
      );
    } else {
      content = token ? lang('$fee_value', {
        fee: <Fee terms={{ native: realFee }} precision="approximate" token={token} />,
      }) : '';
    }

    return (
      <Transition
        className={buildClassName(styles.amountBottomRight, isIncorrectAmount && styles.amountBottomRight_error)}
        slideClassName={styles.amountBottomRight_slide}
        name="fade"
        activeKey={activeKey}
      >
        {content}
      </Transition>
    );
  }

  function renderJettonDescription() {
    return (
      <>
        <p className={modalStyles.text}>
          {renderText(lang('$safe_staking_description_jetton1', {
            jvault_link: (
              <a href={JVAULT_URL} target="_blank" rel="noreferrer"><b>JVault</b></a>
            ),
          }))}
        </p>
        <p className={modalStyles.text}>
          {renderText(lang('$safe_staking_description_jetton2'))}
        </p>
      </>
    );
  }

  function renderTonDescription() {
    return (
      <>
        <p className={modalStyles.text}>
          {renderText(lang('$safe_staking_description1'))}
        </p>
        <p className={modalStyles.text}>
          {renderText(lang('$safe_staking_description2'))}
        </p>
        <p className={modalStyles.text}>
          {renderText(lang('$safe_staking_description3'))}
        </p>
      </>
    );
  }

  function renderSafeInfoModal() {
    if (IS_DELEGATED_BOTTOM_SHEET) return undefined;

    return (
      <Modal
        isCompact
        isOpen={isSafeInfoModalOpen}
        title={lang('Why is staking safe?')}
        onClose={closeSafeInfoModal}
        dialogClassName={styles.stakingSafeDialog}
      >
        {stakingState && stakingState.type === 'jetton' ? renderJettonDescription() : renderTonDescription()}
        <div className={modalStyles.buttons}>
          <Button onClick={closeSafeInfoModal}>{lang('Close')}</Button>
        </div>
      </Modal>
    );
  }

  function renderStakingResult() {
    const balanceResult = amount
      ? toBig(amount).mul((annualYield / 100) + 1).round(SHORT_FRACTION_DIGITS).toString()
      : '0';

    return (
      <RichNumberField
        labelText={lang('Est. balance in a year')}
        zeroValue="..."
        value={balanceResult}
        decimals={decimals}
        className={styles.balanceResultWrapper}
        inputClassName={buildClassName(styles.balanceResultInput, isStatic && styles.inputRichStatic)}
        labelClassName={styles.balanceResultLabel}
        valueClassName={styles.balanceResult}
      />
    );
  }

  const handleChangeStaking = useLastCallback((id: string) => {
    cancelStaking();

    changeCurrentStaking({ stakingId: id, shouldReopenModal: !isStatic });
  });

  return (
    <form
      className={isStatic ? undefined : modalStyles.transitionContent}
      onSubmit={handleSubmit}
    >
      <div className={buildClassName(styles.welcome, isStatic && styles.welcome_static)}>
        <AnimatedIconWithPreview
          size={isStatic ? ANIMATED_STICKER_MIDDLE_SIZE_PX : ANIMATED_STICKER_SMALL_SIZE_PX}
          play={isActive}
          noLoop={false}
          nonInteractive
          className={buildClassName(styles.sticker, isStatic && styles.sticker_static)}
          tgsUrl={ANIMATED_STICKERS_PATHS.wait}
          previewUrl={ANIMATED_STICKERS_PATHS.waitPreview}
        />
        <div className={buildClassName(styles.welcomeInformation, isStatic && styles.welcomeInformation_static)}>
          <div>{lang('Earn from your tokens while holding them', { symbol })}</div>
          <div className={styles.stakingApy}>{lang('Est. %annual_yield%', { annual_yield: `${annualYield}%` })}</div>
          <Button isText className={styles.textButton} onClick={openSafeInfoModal}>
            {lang('Why this is safe')}
          </Button>
        </div>
      </div>

      {renderTopRight()}
      <RichNumberInput
        key="staking_amount"
        id="staking_amount"
        hasError={isIncorrectAmount || isInsufficientBalance}
        value={amount === undefined ? undefined : toDecimal(amount)}
        labelText={lang('Amount')}
        onChange={handleAmountChange}
        onPressEnter={handleSubmit}
        decimals={decimals}
        inputClassName={isStatic ? styles.inputRichStatic : undefined}
        className={styles.amountInput}
      >
        <Dropdown
          items={dropDownItems}
          selectedValue={stakingState?.id}
          className={styles.tokenDropdown}
          itemClassName={styles.tokenDropdownItem}
          onChange={handleChangeStaking}
        />
      </RichNumberInput>
      <div className={buildClassName(styles.amountBottomWrapper, isStatic && styles.amountBottomWrapper_static)}>
        <div className={styles.amountBottom}>
          {renderBottomRight()}
        </div>
      </div>

      {renderStakingResult()}

      <div className={modalStyles.buttons}>
        <Button
          isPrimary
          isSubmit
          isDisabled={!canSubmit}
          isLoading={isLoading}
        >
          {lang('$stake_asset', { symbol: token?.symbol })}
        </Button>
      </div>
      {renderSafeInfoModal()}
    </form>
  );
}

export default memo(
  withGlobal(
    (global): StateProps => {
      const accountId = global.currentAccountId;
      const accountState = selectCurrentAccountState(global);
      const tokens = selectCurrentAccountTokens(global);
      const tokenBySlug = global.tokenInfo.bySlug;

      const {
        state,
        isLoading,
        fee,
        error: apiError,
      } = global.currentStaking;

      const states = accountId ? selectAccountStakingStates(global, accountId) : undefined;
      const stakingState = selectAccountStakingState(global, global.currentAccountId!) ?? global.stakingDefault;

      return {
        isLoading: isLoading && ACTIVE_STATES.has(state),
        tokens,
        tokenBySlug,
        apiError,
        fee,
        stakingState,
        states,
        shouldUseNominators: accountState?.staking?.shouldUseNominators,
      };
    },
    (global, _, stickToFirst) => stickToFirst(global.currentAccountId),
  )(StakingInitial),
);
