/**
 * Set agent wallet using SDK's EIP-712 helper (fixes WA082 warning)
 */
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { signAgentWalletProof } from '@lucid-agents/identity';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;

const abi = [
  {
    name: 'setAgentWallet',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
] as const;

async function main() {
  const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  const agentIdStr = process.env.AGENT_ID;
  
  if (!privateKey || !agentIdStr) {
    console.error('PRIVATE_KEY and AGENT_ID required');
    process.exit(1);
  }

  const agentId = BigInt(agentIdStr);
  const account = privateKeyToAccount(privateKey);
  console.log(`Wallet: ${account.address}`);
  console.log(`Agent ID: ${agentId}`);
  
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: http('https://eth.drpc.org'),
  });

  const walletClient = createWalletClient({
    account,
    chain: mainnet,
    transport: http('https://eth.drpc.org'),
  });

  // Verify ownership
  const owner = await publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi,
    functionName: 'ownerOf',
    args: [agentId],
  });
  
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`Not owner. Agent owned by: ${owner}`);
    process.exit(1);
  }
  console.log('✓ Ownership verified');

  // Set deadline 30 seconds from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30);
  
  // Sign using SDK helper
  console.log('Signing EIP-712 message with SDK helper...');
  const signature = await signAgentWalletProof(walletClient, {
    agentId,
    newWallet: account.address,
    deadline,
    chainId: 1,
    verifyingContract: IDENTITY_REGISTRY,
  });
  console.log(`Signature: ${signature.slice(0, 20)}...`);

  // Submit transaction
  console.log(`Setting agent wallet to: ${account.address}`);
  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi,
    functionName: 'setAgentWallet',
    args: [agentId, account.address, deadline, signature],
  });

  console.log(`TX: https://etherscan.io/tx/${hash}`);
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed in block: ${receipt.blockNumber}`);
  console.log('✅ Agent wallet set!');
}

main().catch(console.error);
