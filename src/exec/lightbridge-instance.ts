import { providers } from 'ethers'
import { BobaChains } from '../utils/chains'
import {ENetworkMode, ILightBridgeOpts, SupportedAssets} from '../utils/types'
import { LightBridgeService } from '../service'

export const startLightBridgeForNetwork = async (opts: ILightBridgeOpts) => {
  const {
    rpcUrl,
    networkMode,
    pollingInterval,
    blockRangePerPolling,
    envModeIsDevelopment,
    awsKmsConfig,
    localNetworks,
  } = opts

  const l2RpcProvider = new providers.StaticJsonRpcProvider(rpcUrl)
  let originSupportedAssets: SupportedAssets
  let teleportationAddress: string

  // get all boba chains and exclude the current chain
  let chainId = (await l2RpcProvider.getNetwork()).chainId

  let selectedBobaChains = localNetworks.selectedBobaNetworks

  if (localNetworks && localNetworks.selectedBobaNetworks.length > 0) {
    chainId = localNetworks.mainNetwork.chainId
    originSupportedAssets = localNetworks.mainNetwork.supportedAssets
    teleportationAddress = localNetworks.mainNetwork.teleportationAddress
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
  }

  console.log('creating lightbridge service with chainId: ', chainId)
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
  })

  await service.start()
}
