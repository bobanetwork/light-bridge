import 'reflect-metadata'
import { DataSource } from 'typeorm'
import { HistoryData } from './entities/HistoryData.entity'
import * as postgres from 'pg' // keep depcheck (db driver)

import dotenv from 'dotenv'
import { LastAirdrop } from './entities/LastAirdrop.entity'

dotenv.config()

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.LIGHTBRIDGE_POSTGRES_DB_HOST ?? 'lightbridge_db',
  port: parseInt(process.env.LIGHTBRIDGE_POSTGRES_PORT ?? '5432', 10),
  username: process.env.LIGHTBRIDGE_POSTGRES_USER ?? 'postgres',
  password: process.env.LIGHTBRIDGE_POSTGRES_PASSWORD ?? 'abcdef',
  database: process.env.LIGHTBRIDGE_POSTGRES_DB ?? 'postgres',
  synchronize: false,
  logging: false,
  entities: [HistoryData, LastAirdrop],
  migrations: [],
  subscribers: [],
})

export const historyDataRepository = AppDataSource.getRepository(HistoryData)
export const lastAirdropRepository = AppDataSource.getRepository(LastAirdrop)
