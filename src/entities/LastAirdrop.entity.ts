import { Entity, Column } from 'typeorm'
import { PrimaryColumn } from 'typeorm/decorator/columns/PrimaryColumn'

@Entity({ name: 'last_airdrop' })
export class LastAirdrop {
  /** @dev This is NOT the sourceChainId, this is the chain the service is running on (to avoid having multiple databases) */
  @PrimaryColumn({ type: 'int', name: 'service_chain_id' })
  serviceChainId: string | number

  /** @dev Chain independent to be more resilient */
  @PrimaryColumn({ type: 'varchar', name: 'wallet_addr' })
  walletAddr: string

  @Column({ type: 'int', name: 'block_timestamp' })
  blockTimestamp: number
}
