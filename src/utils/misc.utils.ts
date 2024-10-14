import { BigNumber } from 'ethers'
import { BobaChains } from '@bobanetwork/light-bridge-chains'

export const delay = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}