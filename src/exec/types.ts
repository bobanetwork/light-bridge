import { IKMSSignerConfig } from '../utils/kms-signing'
import { ChainInfo } from '../utils/types'
import { BigNumberish } from 'ethers'
import { IBobaChain } from '../utils/chains'

export enum ENetworkMode {
  TESTNETS = 'testnets',
  MAINNETS = 'mainnets',
}

export interface ILightBridgeOpts {
  rpcUrl: string
  envModeIsDevelopment: boolean
  networkMode: ENetworkMode
  pollingInterval: number
  blockRangePerPolling: number
  awsKmsConfig: IKMSSignerConfig
  localNetworks?: {
    mainNetwork: IBobaChain
    selectedBobaNetworks: ChainInfo[]
  }
}

export interface IAirdropConfig {
  /** Amount of native gas airdropped to user when conditions are met */
  airdropAmountWei?: BigNumberish
  /** Amount of seconds to wait after previous airdrop */
  airdropCooldownSeconds?: BigNumberish
  /** Define if airdrop is enabled on this network */
  airdropEnabled: boolean
}
