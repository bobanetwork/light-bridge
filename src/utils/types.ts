import { BigNumber, BigNumberish, Contract, providers } from 'ethers'
import { IKMSSignerConfig } from './kms-signing'

export interface SupportedAssets {
  [address: string]: string // symbol (MUST BE UNIQUE)
}

export interface AssetReceivedEvent {
  args: {
    token: string
    sourceChainId: BigNumber
    toChainId: BigNumber
    depositId: BigNumber
    emitter: string
    amount: BigNumber
  }
}

/** @dev Allow airdropping gas only when the sourceNetwork is eligible (security check to avoid arbitrage). */
export enum EAirdropSource {
  ALLOW = 'allow',
  PROHIBIT = 'prohibit',
}

export interface ChainInfo {
  chainId: number
  layer: EAirdropSource
  url: string
  provider: providers.StaticJsonRpcProvider
  testnet: boolean
  name: string
  teleportationAddress: string
  height: number
  supportedAssets: SupportedAssets
  airdropConfig: IAirdropConfig
}

export interface DepositTeleportations {
  Teleportation: Contract
  chainId: number
  totalDeposits: BigNumber
  totalDisbursements: BigNumber
  height: number
}

export interface Disbursement {
  /** @dev Ignored for native disbursements */
  token: string
  amount: string
  addr: string
  sourceChainId: number | string
  depositId: number | string
}

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
    mainNetwork: ChainInfo
    selectedBobaNetworks: ChainInfo[]
  }
}

export interface IAirdropConfig {
  /** Amount of native gas airdropped to user when conditions are met, also used as threshold */
  airdropAmountWei?: BigNumberish
  /** Amount of seconds to wait after previous airdrop */
  airdropCooldownSeconds?: BigNumberish
  /** Define if airdrop is enabled on this network */
  airdropEnabled: boolean
}
