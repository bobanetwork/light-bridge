import { providers } from 'ethers'
import { BobaChains } from '@bobanetwork/light-bridge-chains'
import {
  ENetworkMode,
  ILightBridgeOpts,
  SupportedAssets,
} from '@bobanetwork/light-bridge-chains'
import { LightBridgeService } from '../service'
import { delay } from '../utils/misc.utils'

export const startLightBridgeForNetwork = async (opts: ILightBridgeOpts) => {
  while (true) {
    let service: LightBridgeService
    try {
      console.log(
        `Starting up new Lightbridge instance for ${opts.rpcUrl} (rpcUrl), ${opts.envModeIsDevelopment} (envMode), ${opts.networkMode} (networkMode).`
      )
      service = await runService(opts)
    } catch (err) {
      console.error(
        `Lightbridge instance failed for ${opts.rpcUrl} (rpcUrl), ${opts.envModeIsDevelopment} (envMode), ${opts.networkMode} (networkMode). Retrying in 30 seconds`,
        err?.message,
        err
      )
      try {
        await service?.stop()
      } catch (err) {
        console.error(
          `Could not stop Lightbridge instance for ${opts.rpcUrl} (rpcUrl), ${opts.envModeIsDevelopment} (envMode), ${opts.networkMode} (networkMode).`,
          err?.message,
          err
        )
      }
    }
    await delay(opts.retryIntervalMs ?? 120000)
  }
}

export const selectedNetworkFilter = (chainId: number) => {
  let originSupportedAssets: SupportedAssets
  const selectedBobaChains = Object.keys(BobaChains).reduce((acc, cur) => {
    const chain = BobaChains[cur]
    // only return testnets/mainnets accordingly
    if (chain.testnet !== BobaChains[chainId].testnet) {
      return acc
    }

    if (Number(cur) !== chainId) {
      chain.provider = new providers.StaticJsonRpcProvider(chain.url)
      acc.push({ chainId: cur, ...chain })
    } else {
      originSupportedAssets = chain.supportedAssets
    }
    return acc
  }, [])
  return { selectedBobaChains, originSupportedAssets }
}

const runService = async (opts: ILightBridgeOpts) => {
  const {
    rpcUrl,
    networkMode,
    pollingInterval,
    envModeIsDevelopment,
    awsKmsConfig,
    localNetworks,
    enableExitFee,
  } = opts

  const l2RpcProvider = new providers.StaticJsonRpcProvider(rpcUrl)
  let originSupportedAssets: SupportedAssets
  let teleportationAddress: string

  // get all boba chains and exclude the current chain
  let chainId = (await l2RpcProvider.getNetwork()).chainId

  let selectedBobaChains = localNetworks.selectedBobaNetworks

  if (localNetworks && localNetworks?.selectedBobaNetworks?.length > 0) {
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
    const networkFilter = selectedNetworkFilter(chainId)
    selectedBobaChains = networkFilter.selectedBobaChains
    originSupportedAssets = networkFilter.originSupportedAssets
    teleportationAddress = BobaChains[chainId].teleportationAddress
  }

  console.log('creating lightbridge service with chainId: ', chainId)
  const service = new LightBridgeService({
    l2RpcProvider,
    chainId,
    lightBridgeAddress: teleportationAddress,
    selectedBobaChains,
    ownSupportedAssets: originSupportedAssets,
    pollingInterval,
    blockRangePerPolling: 1000,
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
    enableExitFee,
  })
  await service.start()
  return service
}
