/**
 * Update ERC-8004 registration for nba-stats-agent
 * Run with: PRIVATE_KEY=0x... bun run scripts/update-8004.ts
 */
import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_URL = 'https://nba-stats-agent-production.up.railway.app';

// Full ABI for ERC-8004 Identity Registry
const abi = [
  {
    name: 'setAgentURI',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newURI', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'agentURI',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
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

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`Using wallet: ${account.address}`);
  
  const publicClient = createPublicClient({
    chain: base,
    transport: http('https://mainnet.base.org'),
  });

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http('https://mainnet.base.org'),
  });

  // Find our agent by checking recent token IDs
  // The agent was registered around Jan 31, 2026
  console.log('Looking for owned agents (checking up to 500)...');
  
  // Try more token IDs to find ours
  for (let tokenId = 1n; tokenId <= 500n; tokenId++) {
    if (tokenId % 50n === 0n) console.log(`Checked ${tokenId} tokens...`);
    try {
      const owner = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi,
        functionName: 'ownerOf',
        args: [tokenId],
      });
      
      if (owner.toLowerCase() === account.address.toLowerCase()) {
        console.log(`Found our agent! Token ID: ${tokenId}`);
        
        // Get current URI
        const currentURI = await publicClient.readContract({
          address: IDENTITY_REGISTRY,
          abi,
          functionName: 'agentURI',
          args: [tokenId],
        });
        console.log(`Current URI: ${currentURI}`);
        
        // Update to new URI
        const newURI = `${AGENT_URL}/.well-known/agent.json`;
        console.log(`Updating to: ${newURI}`);
        
        const hash = await walletClient.writeContract({
          address: IDENTITY_REGISTRY,
          abi,
          functionName: 'setAgentURI',
          args: [tokenId, newURI],
        });
        
        console.log(`Transaction: https://basescan.org/tx/${hash}`);
        
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`Confirmed in block: ${receipt.blockNumber}`);
        return;
      }
    } catch (e) {
      // Token doesn't exist or not ours, continue
    }
  }
  
  console.log('No owned agents found in first 500 token IDs');
}

main();
