import { providers } from 'ethers'
import { BobaChains } from '../utils/chains'
import { ChainInfo, SupportedAssets } from '../utils/types'
import { LightBridgeService } from '../service'
import { ENetworkMode, ILightBridgeOpts } from './types'
import path from 'path'

export const lightBridgeWorkerFileName = path.resolve(__filename)

/** This extra file is needed to execute light bridge instances in parallel.
 * I used by piscina, thus it seems to be unused. */
export const startLightBridgeForNetwork = async (opts: ILightBridgeOpts) => {
  const {
    rpcUrl,
    networkMode,
    pollingInterval,
    blockRangePerPolling,
    envModeIsDevelopment,
    awsKmsConfig,
    airdropConfig,
    localNetworks,
  } = opts

  console.log('Light bridge starting up for rpcUrl: ', rpcUrl, opts)

  const l2RpcProvider = new providers.StaticJsonRpcProvider(rpcUrl)
  let originSupportedAssets: SupportedAssets
  let teleportationAddress: string

  // localNetworks: {
  //    selectedBobaNetworks: otherNetworks (filtered),
  //    mainNetwork: network of iteration (must be the same as rpcUrl)
  // }

  // get all boba chains and exclude the current chain
  const chainId = (await l2RpcProvider.getNetwork()).chainId
  let selectedBobaChains = localNetworks.selectedBobaNetworks
  if (localNetworks && localNetworks.selectedBobaNetworks.length > 0) {
    console.log('local networks are defined: ', localNetworks)
    originSupportedAssets = localNetworks.mainNetwork.supportedAssets
    console.log('origin supported assets: ', originSupportedAssets)
    teleportationAddress = localNetworks.mainNetwork.teleportationAddress
    console.log(
      '>>> LOCAL tel addr inside lightbridge-instance.ts',
      teleportationAddress
    )
  } else {
    const isTestnet = BobaChains[chainId].testnet
    if (
      (isTestnet && networkMode === ENetworkMode.MAINNETS) ||
      (!isTestnet && networkMode === ENetworkMode.TESTNETS)
    ) {
      throw new Error('FATAL error: Network Mode and chainConfig do not match!')
    }
    // do not override local networks, production code should ALWAYS go here, since localNetworks should be undefined.
    selectedBobaChains = Object.keys(BobaChains).reduce((acc, cur) => {
      const chain = BobaChains[cur]
      if (isTestnet === chain.testnet) {
        if (Number(cur) !== chainId) {
          chain.provider = new providers.StaticJsonRpcProvider(chain.url)
          acc.push({ chainId: cur, ...chain })
        } else {
          originSupportedAssets = chain.supportedAssets
        }
      }
      return acc
    }, [])
    teleportationAddress = BobaChains[chainId].teleportationAddress
    // todo hint must match the tel addr inside test gen
    console.log('>>>>>> final selected boba chains are: : ', selectedBobaChains)
  }

  console.log('---')
  console.log(
    'starting lightbridgeservice with: ',
    l2RpcProvider.connection.url,
    chainId,
    teleportationAddress,
    selectedBobaChains
  )
  console.log('---')
  const service = new LightBridgeService({
    l2RpcProvider,
    chainId,
    teleportationAddress,
    selectedBobaChains,
    ownSupportedAssets: originSupportedAssets,
    pollingInterval: pollingInterval,
    blockRangePerPolling: blockRangePerPolling,
    awsConfig: {
      awsKmsAccessKey: envModeIsDevelopment
        ? awsKmsConfig.awsKmsAccessKey
        : null,
      awsKmsSecretKey: envModeIsDevelopment
        ? awsKmsConfig.awsKmsSecretKey
        : null,
      awsKmsKeyId: awsKmsConfig.awsKmsKeyId,
      awsKmsRegion: awsKmsConfig.awsKmsRegion,
      awsKmsEndpoint: envModeIsDevelopment ? awsKmsConfig.awsKmsEndpoint : null,
    },
    airdropConfig,
  })

  await service.start()
  // Do not return anything since piscina would wait for it infinitely due to the .start() function's infinite loop
}
