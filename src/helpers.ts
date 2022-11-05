import type { Provider, TransactionReceipt } from "@ethersproject/abstract-provider";
import { AddressZero, HashZero } from "@ethersproject/constants";
import { BigNumber, Contract, ethers, Signer, Wallet, type Transaction } from "ethers";
import { formatUnits, getAddress, Result } from "ethers/lib/utils";
import inquirer from "inquirer";
import keytar from "keytar";
import { ContractName, loadAbi } from "./contracts";
import { listWallets, loadWallet } from "./keystore";
import { LedgerSigner } from "./ledger";
import { NetworkName, Networks } from "./networks";

export type SignerType = "keystore" | "ledger";
export const SignerTypes: SignerType[] = ["keystore", "ledger"];

const Chains: Record<number, string> = {
  0: "mainnet",
  5: "goerli",
};

export function getTxUrl(tx: Transaction): string {
  const chain = Chains[tx.chainId];
  const prefix = chain === "mainnet" ? "" : chain + ".";
  return `https://${prefix}etherscan.io/tx/${tx.hash}`;
}

// Converts union objects returned by ethers to plain objects.
export function normalizeRecord(r: Record<string, unknown> | Result): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(r)
      .filter((k) => isNaN(Number(k)))
      .map((k) => {
        return [k, normalizeRecordValue(r[k])];
      })
  );
}

export function normalizeRecords(rs: (Record<string, unknown> | Result)[]): Record<string, unknown>[] {
  return rs.map((r) => normalizeRecord(r));
}

function normalizeRecordValue(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(normalizeRecordValue);
  }
  if (val instanceof BigNumber) {
    return normalizeBigNumber(val);
  }
  return val;
}

export function normalizeHash(s: string | undefined): string {
  if (!s?.length) {
    return HashZero;
  }
  if (!s.match(/^(0x)?[0-9a-fA-F]{64}$/)) {
    throw Error(`invalid hash: ${s}`);
  }
  return s.startsWith("0x") ? s : "0x" + s;
}

export function normalizeAddress(s: string | undefined): string {
  // getAddress throws on invalid input which is what we want here
  return !s?.length ? AddressZero : getAddress(s);
}

function normalizeBigNumber(n: BigNumber): string {
  try {
    return n.toNumber().toString();
  } catch {
    return formatUnits(n, 18);
  }
}

export async function getProvider(network: NetworkName, rpcUrl: string | undefined): Promise<Provider> {
  const url = rpcUrl ?? Networks[network].url;
  const provider = new ethers.providers.JsonRpcProvider(url);
  return provider;
}

export async function getSigner(
  network: NetworkName,
  rpcUrl: string | undefined,
  address: string | undefined,
  signer: SignerType,
  privateKey: string | undefined
): Promise<Signer> {
  const url = rpcUrl ?? Networks[network].url;
  const provider = new ethers.providers.JsonRpcProvider(url);

  let wallet: Signer;
  if (signer === "ledger") {
    console.log("Make sure the Ledger wallet is unlocked and the Ethereum application is open");
    wallet = new LedgerSigner(provider);
    const address = await wallet.getAddress();
    console.log("Using Ledger wallet. Wallet address: ", address);
  } else if (privateKey) {
    wallet = new Wallet(privateKey);
    wallet = wallet.connect(provider);
  } else {
    if (!address) {
      const wallets = await listWallets();
      if (!wallets.length) {
        throw Error("Error: No private keys found. Use key import command.");
      }

      const res = await inquirer.prompt({
        name: "address",
        message: "Pick the wallet to sign the transaction:",
        type: "list",
        choices: wallets.map((w) => ({
          value: w.address,
          name: w.description ? `${w.address} - ${w.description}` : w.address,
        })),
      });

      address = res.address as string;
    } else {
      const wallets = await listWallets();
      if (!wallets.find((w) => w.address === address)) {
        throw Error(`No saved key for address ${address}`);
      }
    }

    let password = await keytar.getPassword("armada-cli", address);
    if (!password) {
      const res = await inquirer.prompt({
        name: "password",
        message: "Enter the wallet password:",
        type: "password",
      });
      password = res.password as string;
    }

    wallet = await loadWallet(address, password);
    wallet = wallet.connect(provider);
  }

  return wallet;
}

export async function getContract(
  network: NetworkName,
  abiDir: string | undefined,
  contract: ContractName,
  signerOrProvider: Signer | ethers.providers.Provider
): Promise<Contract> {
  const abi = await loadAbi(network, abiDir ?? Networks[network].abi, contract);
  if (signerOrProvider instanceof Signer) {
    const signer = signerOrProvider;
    const contract = new Contract(abi.address, abi.abi, signer.provider);
    const contractWithSigner = contract.connect(signer);
    return contractWithSigner;
  } else {
    const provider = signerOrProvider;
    const contract = new Contract(abi.address, abi.abi, provider);
    return contract;
  }
}

export async function decodeEvents(receipt: TransactionReceipt, contract: Contract, event: string): Promise<Result[]> {
  const results = [];
  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    try {
      const args = contract.interface.decodeEventLog(event, log.data, log.topics);
      if (args) {
        results.push(args);
      }
    } catch {
      continue;
    }
  }
  return results;
}

export async function decodeEvent(receipt: TransactionReceipt, contract: Contract, event: string): Promise<Result> {
  return (await decodeEvents(receipt, contract, event))[0];
}

// Returns all results of a paged function call (a function that accepts skip and size parameters).
export async function getAll(page: number, call: (skip: number, size: number) => Promise<Result[]>): Promise<Result[]> {
  const results: Result[] = [];
  while (page > 0) {
    const records = await call(results.length, page);
    results.push(...records);
    if (records.length !== page) {
      break;
    }
  }
  return results;
}
