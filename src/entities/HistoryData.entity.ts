import { Entity, Column } from 'typeorm'
import { PrimaryColumn } from 'typeorm/decorator/columns/PrimaryColumn'

@Entity({ name: 'history_data' })
export class HistoryData {
  /** @dev This is NOT the sourceChainId, this is the chain the service is running on (to avoid having multiple databases) */
  @PrimaryColumn({ type: 'int', name: 'service_chain_id' })
  serviceChainId: string | number

  @PrimaryColumn({ type: 'int', name: 'deposit_chain_id' })
  depositChainId: string | number

  @Column({ type: 'int', name: 'deposit_block_no' })
  depositBlockNo: number
}
