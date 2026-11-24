import { ethers } from "ethers";

const ABI = [
  "function createEvent(uint256 eventId, uint256 supply)",
  "function mint(address to, uint256 eventId, bytes32 orderRef) returns (uint256)",
  "function tokenByRef(bytes32) view returns (uint256)",
  "function mintedCount(uint256) view returns (uint256)",
  "function maxSupply(uint256) view returns (uint256)",
  "function eventOf(uint256) view returns (uint256)",
  "function eventExists(uint256) view returns (bool)",
  "function ownerOf(uint256) view returns (address)",
  "event EventCreated(uint256 indexed eventId, uint256 maxSupply)",
  "event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, bytes32 indexed orderRef)",
];

const SEPOLIA_CHAIN_ID = 11155111;

const provider = () =>
  new ethers.JsonRpcProvider(
    (process.env.SEPOLIA_RPC_URL || "").trim(),
    SEPOLIA_CHAIN_ID,
    { staticNetwork: true }
  );

export function getReadContract() {
  return new ethers.Contract((process.env.CONTRACT_ADDRESS || "").trim(), ABI, provider());
}

// Wallet kustodian: private key hanya ada di environment variable server.
export function getIssuer(env = process.env) {
  const rpcUrl = (env.SEPOLIA_RPC_URL || "").trim();
  const contractAddr = (env.CONTRACT_ADDRESS || "").trim();
  const privateKey = (env.ISSUER_PRIVATE_KEY || "").trim();
  const rpcProvider = new ethers.JsonRpcProvider(rpcUrl, SEPOLIA_CHAIN_ID, { staticNetwork: true });
  const wallet = new ethers.Wallet(privateKey, rpcProvider);
  return {
    contract: new ethers.Contract(contractAddr, ABI, wallet),
    address: wallet.address,
    provider: wallet.provider,
  };
}

// Referensi unik PER TIKET (bukan per pesanan) supaya 1 pesanan bisa berisi beberapa tiket.
export const refFor = (orderId, index) =>
  ethers.keccak256(ethers.toUtf8Bytes(`${orderId}-${index}`));

const ISSUER_LOCK_KEY = Symbol.for("tixfour.issuerTxLock");

/**
 * Menjalankan transaksi tulis wallet kustodian secara berurutan di dalam satu proses Node
 * agar nonce tidak bertabrakan saat beberapa request/pesanan diproses bersamaan.
 */
export function withIssuerLock(fn) {
  const prev = globalThis[ISSUER_LOCK_KEY] || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  globalThis[ISSUER_LOCK_KEY] = next.catch(() => {});
  return next;
}

/**
 * Memastikan acara sudah terdaftar di smart contract TixFour sebelum minting.
 * Jika eventExists[chainEventId] masih false, otomatis memanggil createEvent.
 */
export async function ensureChainEvent(
  contract,
  chainEventId,
  maxSupply,
  { timeoutMs = 45_000 } = {}
) {
  const exists = await contract.eventExists(chainEventId);
  if (exists) return { created: false };

  const supply = Number(maxSupply);
  if (!Number.isInteger(supply) || supply < 1) {
    throw new Error(`Kuota acara #${chainEventId} tidak valid untuk registrasi smart contract.`);
  }

  try {
    const tx = await contract.createEvent(chainEventId, supply);
    await tx.wait(1, timeoutMs);
    return { created: true, txHash: tx.hash };
  } catch (err) {
    const nowExists = await contract.eventExists(chainEventId).catch(() => false);
    if (nowExists) return { created: false };
    throw err;
  }
}

/**
 * Mengambil tokenId dari log event TicketMinted pada receipt transaksi.
 */
export function extractMintedTokenId(contract, receipt) {
  for (const log of receipt?.logs || []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "TicketMinted") {
        return BigInt(parsed.args.tokenId);
      }
    } catch {
      // Abaikan log yang bukan milik kontrak TixFour
    }
  }
  return 0n;
}
