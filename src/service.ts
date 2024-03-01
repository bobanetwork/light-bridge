/* Imports: External */
import {
  BigNumber,
  constants as ethersConstants,
  Contract,
  ethers,
  EventFilter,
  PopulatedTransaction,
  providers,
} from 'ethers'
import { orderBy } from 'lodash'
import 'reflect-metadata'

/* Imports: Internal */
import { sleep } from '@eth-optimism/core-utils'
import { BaseService } from '@eth-optimism/common-ts'
import { getContractFactory } from '@bobanetwork/core_contracts'
import { getBobaContractAt } from '@bobanetwork/contracts'

import L1ERC20Json from '../artifacts/contracts/test-helpers/L1ERC20.sol/L1ERC20.json'

/* Imports: Interface */
import {
  AssetReceivedEvent,
  ChainInfo,
  DepositTeleportations,
  Disbursement,
  EAirdropSource,
  IAirdropConfig,
  SupportedAssets,
} from './utils/types'
import { HistoryData } from './entities/HistoryData.entity'
import { historyDataRepository, lastAirdropRepository } from './data-source'
import { IKMSSignerConfig, KMSSigner } from './utils/kms-signing'
import { Asset, BobaChains } from './utils/chains'
import { LastAirdrop } from './entities/LastAirdrop.entity'

interface TeleportationOptions {
  l2RpcProvider: providers.StaticJsonRpcProvider

  // chainId of the L2 network
  chainId: number

  // Address of the teleportation contract
  teleportationAddress: string

  selectedBobaChains: ChainInfo[]

  // Own chain to map token symbols to other networks
  ownSupportedAssets: SupportedAssets

  pollingInterval: number

  blockRangePerPolling: number

  awsConfig: IKMSSignerConfig

  /** @dev Can be used to override local config set in BobaChains object */
  airdropConfig?: IAirdropConfig
}

const optionSettings = {}

export class LightBridgeService extends BaseService<TeleportationOptions> {
  constructor(options: TeleportationOptions) {
    super('Teleportation', options, optionSettings)
  }

  private state: {
    Teleportation: Contract
    // the chain is registered in the teleportation contract
    supportedChains: ChainInfo[]
    // the contract of the chain that users deposit token
    depositTeleportations: DepositTeleportations[]
    // AWS KMS Signer for disburser key, ..
    KMSSigner: KMSSigner
    disburserAddress: string
  } = {} as any

  protected async _init(): Promise<void> {
    this.logger.info('Initializing teleportation service...', {
      options: this.options,
    })

    this.state.KMSSigner = new KMSSigner(
      this.options.awsConfig,
      process.env.LIGHTBRIDGE_ENV?.toLowerCase() === 'dev'
    )

    this.state.Teleportation = await getBobaContractAt(
      'Teleportation',
      this.options.teleportationAddress,
      this.options.l2RpcProvider
    )

    this.logger.info('Connected to Teleportation', {
      address: this.state.Teleportation.address,
      chainId: this.options.chainId,
      rpc: this.state.Teleportation.provider,
    })

    // check the disburser wallet is the disburser of the contract
    const disburserAddress = await this.state.Teleportation.disburser()
    const kmsSignerAddress = await this.state.KMSSigner.getSignerAddr()

    if (
      !this.options.awsConfig.disableDisburserCheck &&
      disburserAddress.toLowerCase() !== kmsSignerAddress.toLowerCase()
    ) {
      throw new Error(
        `Disburser wallet ${kmsSignerAddress} is not the disburser of the contract ${disburserAddress}`
      )
    }
    this.state.disburserAddress = kmsSignerAddress

    this.logger.info('Got disburser: ', {
      address: disburserAddress,
      serviceChainId: this.options.chainId,
    })

    // check if all chains are supported
    // if the chain is supported, then store the contract of the chain and the balance info
    // to the state
    this.state.supportedChains = []
    this.state.depositTeleportations = []
    const defaultAssetAddr =
      Object.keys(this.options.ownSupportedAssets).find(
        (k) => this.options.ownSupportedAssets[k?.toLowerCase()] === Asset.BOBA
      ) ?? '0x0000000000000000000000000000000000000000'

    for (const chain of this.options.selectedBobaChains) {
      try {
        const chainId = chain.chainId
        // assuming BOBA is enabled on supported networks to retain battle-tested logic

        this.logger.info('Check if Boba or native supported for chainId: ', {
          chainId,
          bobaTokenContractAddr: defaultAssetAddr,
          serviceChainId: this.options.chainId,
        })

        const isSupported = await this.state.Teleportation.supportedTokens(
          defaultAssetAddr,
          chainId
        )

        if (!isSupported || !isSupported[0]) {
          // do not fail, as secured on-chain anyway & run.ts just returns all testnets/mainnets - thus just ignore networks that don't support Boba
          this.logger.info(
            `Chain ${chainId} is not supported by the contract ${
              this.state.Teleportation.address
            } on chain ${
              (await this.state.Teleportation.provider.getNetwork()).chainId
            }`,
            { serviceChainId: this.options.chainId }
          )
        } else {
          this.state.supportedChains = [...this.state.supportedChains, chain]
          const depositTeleportation = await getBobaContractAt(
            'Teleportation',
            chain.teleportationAddress,
            new providers.StaticJsonRpcProvider(chain.url)
          )
          const totalDisbursements =
            await this.state.Teleportation.totalDisbursements(chainId)

          const totalDeposits = await depositTeleportation.totalDeposits(
            this.options.chainId
          )

          this.logger.info('Total disbursements for chain', {
            chainId,
            totalDisbursements,
            serviceChainId: this.options.chainId,
          })

          this.state.depositTeleportations.push({
            Teleportation: depositTeleportation,
            chainId,
            totalDisbursements,
            totalDeposits,
            height: chain.height,
          })
        }
      } catch (err) {
        this.logger.error(
          `Could not initialize network to disburse on: ${chain.chainId}, ${chain.url}, ${chain.name}`,
          { serviceChainId: this.options.chainId, err }
        )
      }
    }
    this.logger.info('Teleportation service initialized successfully.', {
      serviceChainId: this.options.chainId,
    })
  }

  protected async _start(): Promise<void> {
    while (this.running) {
      for (const depositTeleportation of this.state.depositTeleportations) {
        // search AssetReceived events
        const latestBlock =
          await depositTeleportation.Teleportation.provider.getBlockNumber()
        try {
          const events: AssetReceivedEvent[] = await this._watchTeleportation(
            depositTeleportation,
            latestBlock
          )
          await this._disburseTeleportation(
            depositTeleportation,
            events,
            latestBlock
          )
          this.logger.info('Disbursed teleportations for network', {
            latestBlock,
            serviceChainId: this.options.chainId,
          })
        } catch (err) {
          this.logger.error('Error while running teleportation', {
            err,
            serviceChainId: this.options.chainId,
          })
        }
      }
      await sleep(this.options.pollingInterval)
    }
  }

  async _watchTeleportation(
    depositTeleportation: DepositTeleportations,
    latestBlock: number
  ): Promise<AssetReceivedEvent[]> {
    let lastBlock: number
    const depositChainId = depositTeleportation.chainId.toString()
    try {
      lastBlock = await this._getDepositInfo(depositChainId)
    } catch (e) {
      this.logger.warn(`No deposit info found in chainId - ${depositChainId}`, {
        serviceChainId: this.options.chainId,
      })
      lastBlock = depositTeleportation.height
      // store the new deposit info
      await this._putDepositInfo(depositChainId, lastBlock)
    }
    return this._getEvents(
      depositTeleportation.Teleportation,
      this.state.Teleportation.filters.AssetReceived(),
      lastBlock,
      latestBlock
    )
  }

  async _disburseTeleportation(
    depositTeleportation: DepositTeleportations,
    events: AssetReceivedEvent[],
    latestBlock: number
  ): Promise<void> {
    const depositChainId = depositTeleportation.chainId
    // parse events
    if (events.length === 0) {
      // update the deposit info if no events are found
      await this._putDepositInfo(depositChainId, latestBlock)
    } else {
      const lastDisbursement =
        await this.state.Teleportation.totalDisbursements(depositChainId)
      // eslint-disable-next-line prefer-const
      let disbursement: Disbursement[] = []

      try {
        for (const event of events) {
          const sourceChainId: BigNumber = event.args.sourceChainId
          const depositId = event.args.depositId
          const amount = event.args.amount
          const sourceChainTokenAddr = event.args.token
          const emitter = event.args.emitter
          const destChainId = event.args.toChainId

          if (destChainId.toString() !== this.options.chainId.toString()) {
            this.logger.info(
              'Ignoring event as different destination chainId: ',
              { destChainId, serviceChainId: this.options.chainId }
            )
            continue
          }

          // we disburse tokens only if depositId is greater or equal to the last disbursement
          if (depositId.gte(lastDisbursement)) {
            const destChainTokenAddr =
              this._getSupportedDestChainTokenAddrBySourceChainTokenAddr(
                sourceChainTokenAddr,
                sourceChainId
              )

            const [isTokenSupported, , , , ,] =
              await this.state.Teleportation.supportedTokens(
                destChainTokenAddr,
                sourceChainId
              )
            if (!isTokenSupported) {
              throw new Error(
                `Token '${destChainTokenAddr}' not supported originating from chain '${sourceChainId}' with amount '${amount}'!`
              )
            } else {
              disbursement = [
                ...disbursement,
                {
                  token: destChainTokenAddr, // token mapping for correct routing as addresses different on every network
                  amount: amount.toString(),
                  addr: emitter,
                  depositId: depositId.toNumber(),
                  sourceChainId: sourceChainId.toString(),
                },
              ]
              this.logger.info(
                `Found a new deposit - sourceChainId: ${sourceChainId.toString()} - depositId: ${depositId.toNumber()} - amount: ${amount.toString()} - emitter: ${emitter} - token/native: ${sourceChainTokenAddr}`,
                { serviceChainId: this.options.chainId }
              )
            }
          }
        }

        if (disbursement?.length) {
          // sort disbursement
          disbursement = orderBy(disbursement, ['depositId'], ['asc'])
          // disbure the token but only if all disbursements could have been processed to avoid missing events due to updating the latestBlock
          await this._disburseTx(disbursement, depositChainId, latestBlock)
        } else {
          this.logger.info(
            'No suitable disbursement event for current network',
            { depositChainId, serviceChainId: this.options.chainId }
          )
          await this._putDepositInfo(depositChainId, latestBlock)
        }
      } catch (e) {
        // Catch outside loop to stop at first failing depositID as all subsequent disbursements as depositId = amountDisbursements and would fail when disbursing
        this.logger.error(e.message, { serviceChainId: this.options.chainId })
      }
    }
  }

  async _disburseTx(
    disbursement: Disbursement[],
    depositChainId: number,
    latestBlock: number
  ): Promise<void> {
    try {
      // build payload for the disbursement
      // the maximum number of disbursement is 10
      const numberOfDisbursement = disbursement.length
      let sliceStart = 0
      let sliceEnd = numberOfDisbursement > 10 ? 10 : numberOfDisbursement
      while (sliceStart < numberOfDisbursement) {
        const slicedDisbursement = disbursement.slice(sliceStart, sliceEnd)

        // approve token(s), disbursements can be mixed - sum up token amounts per token
        const tokens: Map<string, BigNumber> = new Map<string, BigNumber>()
        const approvePending = []
        for (const disb of slicedDisbursement) {
          tokens.set(
            disb.token,
            BigNumber.from(disb.amount).add(
              tokens.get(disb.token) ?? BigNumber.from('0')
            )
          )
        }
        // do separate approves if necessary & sum up native requirement
        let nativeValue: BigNumber = BigNumber.from('0')
        for (const token of tokens.entries()) {
          if (token[0] === ethersConstants.AddressZero) {
            nativeValue = nativeValue.add(token[1])
          } else {
            const contract = new Contract(token[0], L1ERC20Json.abi).connect(
              this.state.Teleportation.provider
            ) // getContractFactory('L1ERC20').attach(token[0])
            const approvedAmount = await contract.allowance(
              this.state.disburserAddress,
              this.state.Teleportation.address
            )

            if (approvedAmount.lt(token[1])) {
              const approveTxUnsigned =
                await contract.populateTransaction.approve(
                  this.state.Teleportation.address,
                  ethers.constants.MaxUint256
                )
              const approveTx = await this.state.KMSSigner.sendTxViaKMS(
                this.state.Teleportation.provider,
                token[0],
                BigNumber.from('0'),
                approveTxUnsigned
              )
              approvePending.push(approveTx.wait())
            } else {
              this.logger.info(
                `Not triggering new approve function, since already approved: ${approvedAmount} for token ${token[0]}`
              )
            }
          }
        }
        await Promise.all(approvePending)

        const disburseTxUnsigned =
          await this.state.Teleportation.populateTransaction.disburseAsset(
            slicedDisbursement,
            { value: nativeValue }
          )
        const disburseTx = await this.state.KMSSigner.sendTxViaKMS(
          this.state.Teleportation.provider,
          this.state.Teleportation.address,
          nativeValue,
          disburseTxUnsigned
        )
        await disburseTx.wait()

        sliceStart = sliceEnd
        sliceEnd = Math.min(sliceEnd + 10, numberOfDisbursement)
      }
      this.logger.info(
        `Disbursement successful - serviceChainId: ${
          this.options.chainId
        } - depositChainId: ${depositChainId} - slicedDisbursement:${JSON.stringify(
          disbursement
        )} - latestBlock: ${latestBlock}`,
        { serviceChainId: this.options.chainId }
      )

      await this._putDepositInfo(depositChainId, latestBlock)

      // Only do on boba l2
      if (this.getAirdropConfig()?.airdropEnabled) {
        await this._airdropGas(disbursement, latestBlock)
      } else {
        this.logger.info(
          `Gas airdrop is disabled on chainId: ${this.options.chainId}.`,
          { serviceChainId: this.options.chainId }
        )
      }
    } catch (e) {
      this.logger.error(`Disbursement failed: `, {
        errorMsg: e?.message,
        e,
        serviceChainId: this.options.chainId,
      })
    }
  }

  /** @dev Helper function to read airdropConfig for current service from bobaChains config. */
  private getAirdropConfig = (): IAirdropConfig => {
    // prefer override via opts, right now just used for tests but might be set via env again in future
    return (
      this.options.airdropConfig ??
      BobaChains[this.options.chainId]?.airdropConfig
    )
  }

  /** @dev Checks if major airdrop eligibility criteria has been met such as not bridging native, has no gas on destination network, bridges enough value, .. */
  async _fulfillsAirdropConditions(disbursement: Disbursement) {
    const nativeBalance = await this.state.Teleportation.provider.getBalance(
      disbursement.addr
    )
    const sourceLayer: EAirdropSource =
      this.state.supportedChains.find(
        (c) => c.chainId.toString() === disbursement.sourceChainId.toString()
      )?.layer ?? BobaChains[disbursement.sourceChainId]?.layer
    if (sourceLayer === EAirdropSource.PROHIBIT) {
      this.logger.info(`Not airdropping as sourceNetwork is prohibited.`, {
        sourceChainId: disbursement.sourceChainId,
        layer: sourceLayer,
      })
      return false
    }

    if (nativeBalance.gt(this.getAirdropConfig()?.airdropAmountWei)) {
      this.logger.info(
        `Not airdropping as wallet has native balance on destination network: ${nativeBalance}, wallet: ${disbursement.addr}`,
        { serviceChainId: this.options.chainId }
      )
      return false
    }
    if (disbursement.token === ethers.constants.AddressZero) {
      this.logger.info(
        `Not airdropping as wallet is briding asset that is used to pay for gas on the destination network: ${disbursement.token}, wallet: ${disbursement.addr}`,
        { serviceChainId: this.options.chainId }
      )
      return false
    }
    this.logger.info(`Airdropping for: ${JSON.stringify(disbursement)}`, {
      serviceChainId: this.options.chainId,
    })
    return true
  }

  async _airdropGas(disbursements: Disbursement[], latestBlock: number) {
    const provider = this.state.Teleportation.provider

    for (const disbursement of disbursements) {
      if (await this._fulfillsAirdropConditions(disbursement)) {
        const lastAirdrop = await lastAirdropRepository.findOneBy({
          walletAddr: disbursement.addr,
          serviceChainId: this.options.chainId,
        })
        const unixTimestamp = Math.floor(Date.now() / 1000)

        const airdropCooldownSeconds =
          this.getAirdropConfig()?.airdropCooldownSeconds ?? '86400'
        if (
          !lastAirdrop ||
          BigNumber.from(airdropCooldownSeconds).lt(
            unixTimestamp - lastAirdrop.blockTimestamp
          )
        ) {
          let nativeAmount = this.getAirdropConfig()?.airdropAmountWei
          if (!nativeAmount) {
            // default
            nativeAmount = ethers.utils.parseEther('0.0005')
          }

          const airdropTx = await this.state.KMSSigner.sendTxViaKMS(
            provider,
            disbursement.addr,
            BigNumber.from(nativeAmount.toString()), // native amount, converge types
            { data: '0x' } as PopulatedTransaction // native transfer
          )
          await airdropTx.wait()

          // Save to db
          const blockNumber = (
            await this.state.Teleportation.provider.getBlock('latest')
          )?.timestamp
          const newAirdrop = new LastAirdrop()
          newAirdrop.serviceChainId = this.options.chainId
          newAirdrop.blockTimestamp = blockNumber
          newAirdrop.walletAddr = disbursement.addr
          await lastAirdropRepository.save(newAirdrop)

          this.logger.info(
            `Successfully airdropped gas to ${disbursement.addr}, amount: ${nativeAmount}.`,
            { serviceChainId: this.options.chainId }
          )
        } else {
          this.logger.info(
            `Cool down, user already got an airdrop within the cool down period with this wallet: ${disbursement.addr}.`,
            { serviceChainId: this.options.chainId }
          )
        }
      } else {
        this.logger.info(
          `Not airdropping to ${
            disbursement.addr
          } as not eligible: ${JSON.stringify(disbursement)}`,
          { serviceChainId: this.options.chainId }
        )
      }
    }
  }

  // get events from the contract
  async _getEvents(
    contract: Contract,
    event: EventFilter,
    fromBlock: number,
    toBlock: number
  ): Promise<any> {
    let events = []
    let startBlock = fromBlock
    while (startBlock < toBlock) {
      const endBlock =
        Math.min(startBlock + this.options.blockRangePerPolling, toBlock) + 1 // also include toBlock
      const partialEvents = await contract.queryFilter(
        event,
        startBlock,
        endBlock
      )
      events = [...events, ...partialEvents]
      startBlock = endBlock
    }
    return events
  }

  /**
   * @dev Helper method for accessing the supportedAssets map via value (needed as we need it one way another as we don't save the ticker on-chain).
   * @param sourceChainTokenAddr: Token/Asset address (ZeroAddr for native asset) on source network
   * @param sourceChainId: ChainId the request is coming from
   **/
  _getSupportedDestChainTokenAddrBySourceChainTokenAddr(
    sourceChainTokenAddr: string,
    sourceChainId: BigNumber | number
  ) {
    const srcChain: ChainInfo = this.state.supportedChains.find(
      (c) => c.chainId.toString() === sourceChainId.toString()
    )
    if (!srcChain) {
      throw new Error(
        `Source chain not configured/supported: ${srcChain} - ${sourceChainId} - supported: ${JSON.stringify(
          this.state.supportedChains.map((c) => c.chainId)
        )}`
      )
    }

    const srcChainTokenSymbol =
      srcChain.supportedAssets[sourceChainTokenAddr?.toLowerCase()]

    const supportedAsset = Object.entries(this.options.ownSupportedAssets).find(
      ([address, tokenSymbol]) => {
        return tokenSymbol === srcChainTokenSymbol
      }
    )

    if (!supportedAsset) {
      throw new Error(
        `Asset ${srcChainTokenSymbol} on chain destinationChain not configured but possibly supported on-chain`
      )
    }
    return supportedAsset[0] // return only address
  }

  async _putDepositInfo(
    depositChainId: number | string,
    latestBlock: number
  ): Promise<void> {
    try {
      const historyData = new HistoryData()
      historyData.serviceChainId = this.options.chainId
      historyData.depositChainId = depositChainId
      historyData.depositBlockNo = latestBlock
      if (
        await historyDataRepository.findOneBy({
          depositChainId,
          serviceChainId: this.options.chainId,
        })
      ) {
        await historyDataRepository.update(
          { depositChainId, serviceChainId: this.options.chainId },
          historyData
        )
      } else {
        await historyDataRepository.save(historyData)
      }
    } catch (error) {
      this.logger.error(`Failed to put depositInfo! - ${error}`, {
        serviceChainId: this.options.chainId,
      })
    }
  }

  async _getDepositInfo(chainId: number | string): Promise<number> {
    const historyData = await historyDataRepository.findOneBy({
      depositChainId: chainId,
    })

    if (historyData) {
      return historyData.depositBlockNo
    } else {
      throw new Error("Can't find latestBlock in depositInfo")
    }
  }
}
