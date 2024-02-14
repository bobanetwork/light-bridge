import { MigrationInterface, QueryRunner, Table } from 'typeorm'

export class Init1687802800701 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS history_data (service_chain_id int NOT NULL, deposit_chain_id int NOT NULL, deposit_block_no int NULL, PRIMARY KEY (service_chain_id, deposit_chain_id))`
    )
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('history_data', true)
  }
}
