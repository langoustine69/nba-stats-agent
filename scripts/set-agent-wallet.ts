/**
 * Set agent wallet using the new method (fixes WA082 warning)
 * This removes the deprecated on-chain agentWallet and uses setAgentWallet()
 */
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

const abi = [
  {
    name: 'setAgentWallet',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'wallet', type: 'address' },
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
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY required');
    process.exit(1);
  }

  const agentId = process.env.AGENT_ID;
  if (!agentId) {
    console.error('AGENT_ID required');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
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

  try {
    // Verify we own this agent
    const owner = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi,
      functionName: 'ownerOf',
      args: [BigInt(agentId)],
    });
    
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
      console.error(`Not owner. Agent owned by: ${owner}`);
      process.exit(1);
    }

    console.log(`Setting agent wallet to: ${account.address}`);
    
    const hash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY,
      abi,
      functionName: 'setAgentWallet',
      args: [BigInt(agentId), account.address],
    });

    console.log(`TX: https://etherscan.io/tx/${hash}`);
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Confirmed in block: ${receipt.blockNumber}`);
    console.log('✅ Agent wallet set!');
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

main();
