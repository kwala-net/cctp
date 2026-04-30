// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Tracks CCTP V2 transfer requests initiated from the web interface.
///         Anyone can register a burn, anyone can mark it completed.
///         Permissionless — this is a demo registry, not a financial primitive.
contract CCTPRegistry {
    struct TransferRequest {
        bytes32 burnTxHash;
        uint32  srcDomain;
        uint32  dstDomain;
        address sender;
        uint256 amount;      // USDC amount in 6-decimal base units
        bool    attested;
        uint256 createdAt;
        bytes   messageBytes;
        bytes   attestation;
    }

    /// burnTxHash → request
    mapping(bytes32 => TransferRequest) public requests;
    /// ordered list of all registered burnTxHashes
    bytes32[] public allIds;

    event RequestRegistered(bytes32 indexed burnTxHash, address indexed sender, uint32 srcDomain, uint32 dstDomain, uint256 amount);
    /// Emitted when the Circle attestation is ready. Kwala listens for this to call receiveMessage on the destination chain.
    event RequestCompleted(bytes32 indexed burnTxHash, address indexed sender, bytes messageBytes, bytes attestation);

    /// @notice Register a new transfer request right after the burn tx is submitted.
    function register(
        bytes32 burnTxHash,
        uint32  srcDomain,
        uint32  dstDomain,
        uint256 amount
    ) external {
        require(requests[burnTxHash].createdAt == 0, "Already registered");
        requests[burnTxHash] = TransferRequest({
            burnTxHash:   burnTxHash,
            srcDomain:    srcDomain,
            dstDomain:    dstDomain,
            sender:       msg.sender,
            amount:       amount,
            attested:     false,
            createdAt:    block.timestamp,
            messageBytes: '',
            attestation:  ''
        });
        allIds.push(burnTxHash);
        emit RequestRegistered(burnTxHash, msg.sender, srcDomain, dstDomain, amount);
    }

    /// @notice Record the Circle attestation once ready. Emits RequestCompleted so Kwala
    ///         can call receiveMessage on the destination chain without the user signing.
    function markAttested(
        bytes32 burnTxHash,
        bytes calldata messageBytes,
        bytes calldata attestation
    ) external {
        require(requests[burnTxHash].createdAt != 0, "Not found");
        require(!requests[burnTxHash].attested,      "Already attested");
        TransferRequest storage req = requests[burnTxHash];
        req.attested     = true;
        req.messageBytes = messageBytes;
        req.attestation  = attestation;
        emit RequestCompleted(burnTxHash, req.sender, messageBytes, attestation);
    }

    /// @notice Return all pending (not-yet-completed) requests.
    ///         Called by the Next.js API route to get the list to poll Circle for.
    function getPendingRequests()
        external
        view
        returns (bytes32[] memory txHashes, uint32[] memory srcDomains)
    {
        uint256 total = allIds.length;
        uint256 count = 0;
        for (uint256 i = 0; i < total; i++) {
            if (!requests[allIds[i]].attested) count++;
        }

        txHashes   = new bytes32[](count);
        srcDomains = new uint32[](count);

        uint256 idx = 0;
        for (uint256 i = 0; i < total; i++) {
            bytes32 id = allIds[i];
            if (!requests[id].attested) {
                txHashes[idx]   = id;
                srcDomains[idx] = requests[id].srcDomain;
                idx++;
            }
        }
    }

    /// @notice Total number of registered requests (pending + completed).
    function totalRequests() external view returns (uint256) {
        return allIds.length;
    }
}
