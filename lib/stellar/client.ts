import "server-only"

import { Horizon, Networks, rpc } from "@stellar/stellar-sdk"

import { getStellarConfig, parseStellarNetwork, type StellarConfig, type StellarNetwork } from "./config"

/**
 * The Stellar transaction network passphrase for a configured ChainMove
 * network. Use this when constructing or parsing transactions.
 */
export function getStellarNetworkPassphrase(network: StellarNetwork = getStellarConfig().network): string {
  return parseStellarNetwork(network) === "mainnet" ? Networks.PUBLIC : Networks.TESTNET
}

/** Creates a Horizon client using ChainMove's selected Stellar network. */
export function getHorizonServer(config: StellarConfig = getStellarConfig()): Horizon.Server {
  return new Horizon.Server(config.horizonUrl)
}

/** Creates a Soroban RPC client using ChainMove's selected Stellar network. */
export function getSorobanRpcServer(config: StellarConfig = getStellarConfig()): rpc.Server {
  return new rpc.Server(config.rpcUrl)
}

export interface StellarClient {
  config: StellarConfig
  networkPassphrase: string
  horizon: Horizon.Server
  sorobanRpc: rpc.Server
}

/**
 * Creates all server-side Stellar clients from one resolved configuration.
 * This module is marked `server-only` to prevent SDK clients from being
 * imported into frontend components.
 */
export function getStellarClient(config: StellarConfig = getStellarConfig()): StellarClient {
  return {
    config,
    networkPassphrase: getStellarNetworkPassphrase(config.network),
    horizon: getHorizonServer(config),
    sorobanRpc: getSorobanRpcServer(config),
  }
}
