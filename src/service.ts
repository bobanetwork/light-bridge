/* Imports: External */
import {
  BigNumber,
  constants as ethersConstants,
  Contract,
  ethers,
  PopulatedTransaction,
  providers,
} from 'ethers'
import { orderBy } from 'lodash'

/* Imports: Internal */
import { sleep } from '@eth-optimism/core-utils'
import { BaseService } from '@eth-optimism/common-ts'
import { getBobaContractAt } from '@bobanetwork/contracts'

import L1ERC20Json from '../artifacts/contracts/test-helpers/L1ERC20.sol/L1ERC20.json'
import LightBridgeABI from '../artifacts/contracts/LightBridge.sol/LightBridge.json'

/* Imports: Interface */
import {
  ChainInfo,
  DepositTeleportations,
  Disbursement,
  EAirdropSource,
  IAirdropConfig,
  SupportedAssets,
  IKMSSignerConfig,
} from '@bobanetwork/light-bridge-chains'
import { KMSSigner } from '@bobanetwork/aws-kms'
import { Asset, BobaChains } from '@bobanetwork/light-bridge-chains'
import {
  LightBridgeAssetReceivedEvent,
  lightBridgeGraphQLService,
} from '@bobanetwork/graphql-utils'
import { deductExitFeeIfApplicable, hasRecentAirdrop } from './utils/misc.utils'

interface LightBridgeOptions {
  l2RpcProvider: providers.StaticJsonRpcProvider

  // chainId of the L2 network
  chainId: number

  // Address of the teleportation contract
  lightBridgeAddress: string

  selectedBobaChains: ChainInfo[]

  // Own chain to map token symbols to other networks
  ownSupportedAssets: SupportedAssets

  pollingInterval: number
  blockRangePerPolling: number

  awsConfig: IKMSSignerConfig

  /** @dev Can be used to override local config set in BobaChains object */
  airdropConfig?: IAirdropConfig

  enableExitFee?: boolean
}

const optionSettings = {}

export class LightBridgeService extends BaseService<LightBridgeOptions> {
  private recentAirdrops: Map<string, number> = new Map() // walletAddress -> timestamp

  constructor(options: LightBridgeOptions) {
    super('Teleportation', options, optionSettings)
  }

  public state: {
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

    this.state.Teleportation = new Contract(
      this.options.lightBridgeAddress,
      LightBridgeABI.abi,
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
        `Disburser wallet ${kmsSignerAddress} is not the disburser of the contract, disburser from contract: ${disburserAddress}`
      )
    }
    this.state.disburserAddress = kmsSignerAddress

    this.logger.info('Got disburser: ', {
      address: disburserAddress,
      serviceChainId: this.options.chainId,
    })

    await this.getSupportedNetworks(this.options.selectedBobaChains)

    this.logger.info('Teleportation service initialized successfully.', {
      serviceChainId: this.options.chainId,
    })
  }

  public async getSupportedNetworks(selectedBobaChains: ChainInfo[]) {
    // check if all chains are supported
    // if the chain is supported, then store the contract of the chain and the balance info
    // to the state
    this.state.supportedChains = []
    this.state.depositTeleportations = []

    this.logger.info(
      'getSupportedNetworks: Starting with these chains to evaluate support -> ',
      { chainIds: JSON.stringify(selectedBobaChains.map((c) => c.chainId)) }
    )

    const defaultAssetAddr =
      Object.keys(this.options.ownSupportedAssets).find(
        (k) => this.options.ownSupportedAssets[k?.toLowerCase()] === Asset.BOBA
      ) ?? '0x0000000000000000000000000000000000000000'

    for (const chain of selectedBobaChains) {
      try {
        const chainId = chain.chainId
        // assuming BOBA is enabled on supported networks to retain battle-tested logic

        this.logger.info('Check if Boba or native supported for chainId: ', {
          chainId,
          bobaTokenContractAddr: defaultAssetAddr,
          serviceChainId: this.options.chainId,
          chainUrl: chain.url,
          chainName: chain.name,
        })

        this.logger.info(
          `Attempting to connect to chain ${chainId} at ${chain.url}`
        )
        const depositTeleportation = await getBobaContractAt(
          'Teleportation',
          chain.teleportationAddress,
          new providers.StaticJsonRpcProvider(chain.url)
        )
        this.logger.info(`Successfully connected to chain ${chainId}`)

        this.logger.info(`Checking if tokens are supported on chain ${chainId}`)
        const isSupported = await this.state.Teleportation.supportedTokens(
          defaultAssetAddr,
          chainId
        )
        this.logger.info(`Support check result for chain ${chainId}:`, {
          isSupported,
        })

        let noDefaultAssetSupported = !isSupported || !isSupported[0]
        if (
          noDefaultAssetSupported &&
          defaultAssetAddr !== ethers.constants.AddressZero
        ) {
          this.logger.warn(
            `(trying with zeroAddress too) Default asset ${defaultAssetAddr} is not supported for chainId ${chainId}, contract ${
              this.state.Teleportation.address
            } on chain ${
              (await this.state.Teleportation.provider.getNetwork()).chainId
            }`,
            { serviceChainId: this.options.chainId }
          )

          const isSupportedZero =
            await this.state.Teleportation.supportedTokens(
              ethers.constants.AddressZero,
              chainId
            )
          noDefaultAssetSupported = !isSupportedZero || !isSupportedZero[0]
          this.logger.info(
            `ZeroAddress is not supported either: ${noDefaultAssetSupported}`,
            { serviceChainId: this.options.chainId, destChainId: chainId }
          )
        }

        if (noDefaultAssetSupported) {
          // do not fail, as secured on-chain anyway & run.ts just returns all testnets/mainnets - thus just ignore networks that don't support Boba
          this.logger.warn(
            `Chain ${chainId} is not supported by the contract ${
              this.state.Teleportation.address
            } on chain ${
              (await this.state.Teleportation.provider.getNetwork()).chainId
            }`,
            { serviceChainId: this.options.chainId }
          )
        } else {
          this.state.supportedChains = [...this.state.supportedChains, chain]
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
          {
            serviceChainId: this.options.chainId,
            err: err.message,
            fullError: err,
          }
        )
      }
    }

    this.logger.info('Final getSupportedNetworks results:', {
      supportedChainsCount: this.state.supportedChains.length,
      supportedChainIds: this.state.supportedChains.map((c) => c.chainId),
      depositTeleportationsCount: this.state.depositTeleportations.length,
      depositTeleportationChainIds: this.state.depositTeleportations.map(
        (d) => d.chainId
      ),
    })
  }

  protected async _start(): Promise<void> {
    while (this.running) {
      for (const depositTeleportation of this.state.depositTeleportations) {
        // search AssetReceived events
        const latestBlock =
          await depositTeleportation.Teleportation.provider.getBlockNumber()
        try {
          const events: LightBridgeAssetReceivedEvent[] =
            await this._watchTeleportation(depositTeleportation, latestBlock)
          await this._disburseTeleportation(
            depositTeleportation,
            events,
            latestBlock
          )
        } catch (err) {
          this.logger.error('Error while running teleportation', {
            err,
            serviceChainId: this.options.chainId,
          })
        }
      }
      await sleep(this.options.pollingInterval)
      this.logger.info('Disbursed teleportations for networks', {
        chainIds: this.state.depositTeleportations.map((c) => c.chainId),
        serviceChainId: this.options.chainId,
      })
    }
  }

  async _watchTeleportation(
    depositTeleportation: DepositTeleportations,
    latestBlock: number
  ): Promise<LightBridgeAssetReceivedEvent[]> {
    const depositChainId = depositTeleportation.chainId.toString()

    // Get the last disbursement count from the smart contract instead of using database
    const lastDisbursement =
      await this.state.Teleportation.totalDisbursements(depositChainId)

    this.logger.info(
      `Getting events for chain ${depositChainId}, lastDisbursement: ${lastDisbursement.toString()}`,
      {
        serviceChainId: this.options.chainId,
      }
    )

    return this._getAssetReceivedEvents(
      depositTeleportation.chainId,
      this.options.chainId,
      depositTeleportation.height,
      latestBlock,
      lastDisbursement,
      depositTeleportation.Teleportation
    )
  }

  async _disburseTeleportation(
    depositTeleportation: DepositTeleportations,
    events: LightBridgeAssetReceivedEvent[],
    latestBlock: number
  ): Promise<void> {
    const depositChainId = depositTeleportation.chainId
    // parse events
    if (events.length === 0) {
      this.logger.info('No events found for disbursement', {
        depositChainId,
        serviceChainId: this.options.chainId,
      })
    } else {
      const lastDisbursement =
        await this.state.Teleportation.totalDisbursements(depositChainId)
      // eslint-disable-next-line prefer-const
      let disbursement: Disbursement[] = []
      this.logger.info(`Found ${events.length} events for disbursement`, {
        depositIds: events.map((e) => e.depositId),
        serviceChainId: this.options.chainId,
      })

      try {
        for (const event of events) {
          const sourceChainId: BigNumber = BigNumber.from(
            event.sourceChainId.toString()
          )
          const depositId: BigNumber = BigNumber.from(
            event.depositId.toString()
          )
          const amount: BigNumber = BigNumber.from(event.amount.toString())
          const sourceChainTokenAddr = event.token
          const emitter = event.emitter
          const destChainId: BigNumber = BigNumber.from(
            event.toChainId.toString()
          )

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

            const [isTokenSupported] =
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
                  amount: deductExitFeeIfApplicable(
                    this.options.enableExitFee,
                    this.options.chainId,
                    amount
                  ).toString(),
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
          // disbure the token but only if all disbursements could have been processed to avoid missing events due to updating the latestBlock
          await this._disburseTx(disbursement, depositChainId, latestBlock)
        } else {
          this.logger.info(
            'No suitable disbursement event for current network',
            { depositChainId, serviceChainId: this.options.chainId }
          )
        }
      } catch (e) {
        // Catch outside loop to stop at first failing depositID as all subsequent disbursements as depositId = amountDisbursements and would fail when disbursing
        this.logger.error(`Fatal disbursement error: `, {
          errorMsg: e?.message,
          err: JSON.stringify(e),
          serviceChainId: this.options.chainId,
        })
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
      disbursement = await this.filterForNewDisbursements(disbursement) // filter for latest depositId for DB recovery
      // sort disbursement
      disbursement = orderBy(disbursement, ['depositId'], ['asc'])

      const numberOfDisbursement = disbursement.length
      let sliceStart = 0
      let sliceEnd = numberOfDisbursement > 10 ? 10 : numberOfDisbursement
      while (sliceStart < numberOfDisbursement) {
        let slicedDisbursement = disbursement.slice(sliceStart, sliceEnd)

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
            ) // getContractFactory('L2StandardERC20').attach(token[0])
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

            // also check if enough balance, otherwise just disburse what is available
            const disburserBalance = await contract.balanceOf(
              this.state.disburserAddress
            )
            if (disburserBalance.lt(token[1])) {
              this.logger.error(
                `Not enough balance to disburse token ${
                  token[0]
                }: ${disburserBalance.toString()} < ${token[1].toString()}`
              )
              throw new Error(
                `Not enough balance to disburse token ${
                  token[0]
                }: ${disburserBalance.toString()} < ${token[1].toString()}`
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
        this.logger.info(`Disbursement Slice disbursed: `, {
          disburseTx: disburseTx?.hash,
          chainId: disburseTx?.chainId,
        })
      }
      this.logger.info(
        `Disbursement successful - serviceChainId: ${
          this.options.chainId
        } - depositChainId: ${depositChainId} - slicedDisbursement:${JSON.stringify(
          disbursement
        )} - latestBlock: ${latestBlock}`,
        { serviceChainId: this.options.chainId }
      )

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
        err: JSON.stringify(e),
        serviceChainId: this.options.chainId,
      })
    }
  }

  /** @dev When the database state gets lost for some reason, the service needs to be able to pick the latest depositId up */
  private filterForNewDisbursements = async (
    disbursements: Disbursement[]
  ): Promise<Disbursement[]> => {
    // totalDisbursements[sourceChainId]
    const nextDepositIds: { [sourceChainId: number]: string } = {}
    await Promise.all(
      disbursements.map(async (d) => {
        nextDepositIds[d.sourceChainId as number] = (
          await this.state.Teleportation.totalDisbursements(
            d.sourceChainId.toString()
          )
        )?.toString()
      })
    )
    this.logger.info(`Unfiltered disbursements for db recovery: `, {
      disbursements,
    })
    disbursements = disbursements.filter((d) => {
      // NOTE: Filter does not work with async, since a Promise object always gets interpreted as true
      this.logger.debug(`Filter iteration for new disbursements (db recover)`, {
        disbursement: d,
        sourceChain: d.sourceChainId,
        nextDepositIds,
        depositIdLoaded: d.sourceChainId in nextDepositIds,
        depositIdLoaded2: nextDepositIds[d.sourceChainId],
      })
      // only try to disburse those who haven't been disbursed from a previous service already before DB state got lost
      return d.depositId >= nextDepositIds[d.sourceChainId]
    })
    this.logger.info(`Filtered disbursements for db recovery: `, {
      disbursements,
      nextDepositIdsKeys: Object.keys(nextDepositIds),
      nextDepositIds,
    })

    for (const sourceChainId of Object.keys(nextDepositIds)) {
      const nextDisbursement = disbursements.find(
        (d) => nextDepositIds[sourceChainId] === d.depositId.toString()
      )
      if (disbursements.length > 0 && !nextDisbursement) {
        this.logger.error(
          `Could NOT recover state, continuing with available disbursements.`,
          { disbursements, nextDepositIds }
        )
      } else {
        this.logger.info(`Found correct disbursement to be used next: `, {
          nextDisbursement,
        })
      }
    }
    return disbursements
  }

  /*todo private retryNativeDisbursement = async (depositIds: number[]) => {
    // totalDisbursements[_sourceChainId]
    const disburseTxUnsigned =
        await this.state.Teleportation.populateTransaction.retryDisburseNative(
            depositIds,
            { value: nativeValue }
        )
    const disburseTx = await this.state.KMSSigner.sendTxViaKMS(
        this.state.Teleportation.provider,
        this.state.Teleportation.address,
        nativeValue,
        disburseTxUnsigned
    )
    await disburseTx.wait()
  }*/

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

  /** @dev Helper function to check if an address has received recent airdrops using in-memory tracking */
  private hasRecentAirdropInMemory(
    walletAddress: string,
    cooldownSeconds: number
  ): boolean {
    const currentTimestamp = Math.floor(Date.now() / 1000)
    const lastAirdropTime = this.recentAirdrops.get(walletAddress.toLowerCase())

    if (!lastAirdropTime) {
      return false
    }

    const timeSinceLastAirdrop = currentTimestamp - lastAirdropTime
    return timeSinceLastAirdrop < cooldownSeconds
  }

  /** @dev Helper function to record an airdrop in memory */
  private recordAirdrop(walletAddress: string): void {
    const currentTimestamp = Math.floor(Date.now() / 1000)
    this.recentAirdrops.set(walletAddress.toLowerCase(), currentTimestamp)

    // Clean up old entries (older than 24 hours) to prevent memory bloat
    const cutoffTime = currentTimestamp - 86400
    for (const [address, timestamp] of this.recentAirdrops.entries()) {
      if (timestamp < cutoffTime) {
        this.recentAirdrops.delete(address)
      }
    }
  }

  async _airdropGas(disbursements: Disbursement[], latestBlock: number) {
    for (const disbursement of disbursements) {
      if (await this._fulfillsAirdropConditions(disbursement)) {
        const cooldownSeconds = Number(
          this.getAirdropConfig()?.airdropCooldownSeconds ?? 86400
        )

        // Check both GraphQL and in-memory cache for recent airdrops
        const recentAirdropGraphQL = await hasRecentAirdrop(
          disbursement.addr,
          this.options.chainId,
          cooldownSeconds
        )

        const recentAirdropInMemory = this.hasRecentAirdropInMemory(
          disbursement.addr,
          cooldownSeconds
        )

        if (!recentAirdropGraphQL && !recentAirdropInMemory) {
          const nativeAmount = BigNumber.from(
            this.getAirdropConfig()?.airdropAmountWei ??
              ethers.utils.parseEther('0.0005')
          )

          this.logger.info(
            `Airdropping gas to ${disbursement.addr}, amount: ${nativeAmount}.`,
            { serviceChainId: this.options.chainId }
          )

          try {
            const airdropTx = await this.state.KMSSigner.sendTxViaKMS(
              this.state.Teleportation.provider,
              disbursement.addr,
              nativeAmount,
              { data: '0x' } as PopulatedTransaction // minimal transaction for native transfer
            )
            await airdropTx.wait()

            // Record the airdrop in memory to enforce cooldown
            this.recordAirdrop(disbursement.addr)

            this.logger.info(
              `Successfully airdropped gas to ${disbursement.addr}, amount: ${nativeAmount}.`,
              { serviceChainId: this.options.chainId }
            )
          } catch (error) {
            this.logger.error(
              `Failed to airdrop gas to ${disbursement.addr}: ${error}`,
              {
                serviceChainId: this.options.chainId,
              }
            )
          }
        } else {
          this.logger.info(
            `Cooldown active: ${disbursement.addr} has received recent activity, skipping airdrop.`,
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

  async _getAssetReceivedEventsViaQueryFilter(
    contract: Contract,
    fromBlock: number,
    toBlock: number
  ): Promise<LightBridgeAssetReceivedEvent[]> {
    let events: LightBridgeAssetReceivedEvent[] = []
    let startBlock = fromBlock
    while (startBlock < toBlock) {
      const endBlock =
        Math.min(startBlock + this.options.blockRangePerPolling, toBlock) + 1 // also include toBlock
      const partialEvents: LightBridgeAssetReceivedEvent[] = (
        await contract.queryFilter(
          this.state.Teleportation.filters.AssetReceived(),
          startBlock,
          endBlock
        )
      ).map((e) => {
        return {
          sourceChainId: e.args.sourceChainId.toString(),
          toChainId: e.args.toChainId.toString(),
          depositId: e.args.depositId.toString(),
          amount: e.args.amount.toString(),
          token: e.args.token,
          emitter: e.args.emitter,
          block_number: e.blockNumber.toString(),
          timestamp_: undefined, // not available via filter without making another rpc call
          transactionHash_: e.transactionHash,
          __typename: 'AssetReceived',
        }
      })
      events = [...events, ...partialEvents]
      startBlock = endBlock
    }
    return events
  }

  // get events from the contract
  async _getAssetReceivedEvents(
    sourceChainId: number,
    targetChainId: number,
    fromBlock: number,
    toBlock: number,
    lastDisbursement: BigNumber,
    contract?: Contract
  ): Promise<LightBridgeAssetReceivedEvent[]> {
    let events: LightBridgeAssetReceivedEvent[]

    try {
      events = await lightBridgeGraphQLService.queryAssetReceivedEvent(
        sourceChainId,
        targetChainId,
        null,
        null,
        null,
        lastDisbursement.toString() // use lastDisbursement for filtering
      )
    } catch (err) {
      this.logger.warn(`Caught GraphQL error!`, {
        errMsg: err?.message,
        err,
        sourceChainId,
        targetChainId,
        fromBlock,
        toBlock,
      })
      if (contract) {
        events = await this._getAssetReceivedEventsViaQueryFilter(
          contract,
          fromBlock,
          toBlock
        )
      } else {
        throw new Error(
          `GraphQL error and queryFilter not available: ${err?.message}, sourceChain: ${sourceChainId}, targetChain: ${targetChainId}, fromBlock: ${fromBlock}, toBlock: ${toBlock}`
        )
      }
    }
    return events.map((e) => {
      // make sure typings are correct
      return {
        ...e,
        sourceChainId: e.sourceChainId.toString(),
        toChainId: e.toChainId.toString(),
        depositId: e.depositId.toString(),
        amount: e.amount.toString(),
        block_number: e.block_number.toString(),
        timestamp_: e.timestamp_?.toString() || '0', // Handle undefined timestamp_ safely
      }
    })
  }

  /**
   * @dev Helper method for accessing the supportedAssets map via value (needed as we need it one way another as we don't save the ticker on-chain).
   * @param sourceChainTokenAddr: Token/Asset address (ZeroAddr for native asset) on source network
   * @param sourceChainId: ChainId the request is coming from
   **/
  _getSupportedDestChainTokenAddrBySourceChainTokenAddr(
    sourceChainTokenAddr: string,
    sourceChainId: BigNumber | number | string
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
        `Asset ${srcChainTokenSymbol} on chain destinationChain not configured but possibly supported on-chain: ${sourceChainTokenAddr} - ${sourceChainId} - supported: ${JSON.stringify(
          srcChain.supportedAssets
        )}`
      )
    }
    return supportedAsset[0] // return only address
  }
}
