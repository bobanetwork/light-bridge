import { IKMSSignerConfig } from '../utils/kms-signing'
import { IAirdropConfig } from '../service'
import { ChainInfo } from '../utils/types'
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
  airdropConfig?: IAirdropConfig
  localNetworks?: {
    mainNetwork: IBobaChain
    selectedBobaNetworks: ChainInfo[]
  }
}
