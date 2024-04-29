import { BigNumber } from 'ethers'
import { BobaChains } from '@bobanetwork/light-bridge-chains'

export const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const deductExitFeeIfApplicable = (
  enableExitFee: boolean,
  serviceChainId: number,
  amount: BigNumber
): BigNumber => {
  // deduct fee for L1 networks or not Boba Foundation owned networks (basically fee is applied to all networks that have no airdrop support)
  if (
    enableExitFee &&
    !BobaChains[serviceChainId]?.airdropConfig?.airdropEnabled
  ) {
    return amount.mul(99).div(100)
  }
  return amount
}
