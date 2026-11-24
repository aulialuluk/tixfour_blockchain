// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title TixFour - tiket ERC-721 non-transferable (MVP)
/// @notice Hanya owner (wallet server) yang bisa membuat acara dan menerbitkan tiket.
contract TixFour is ERC721, Ownable {
    uint256 private _nextTokenId = 1; // token ID mulai dari 1, 0 = "tidak ada"

    mapping(uint256 => bool) public eventExists;
    mapping(uint256 => uint256) public maxSupply;     // eventId => kuota
    mapping(uint256 => uint256) public mintedCount;   // eventId => jumlah terbit
    mapping(uint256 => uint256) public eventOf;       // tokenId => eventId
    mapping(bytes32 => uint256) public tokenByRef;    // orderRef (hash) => tokenId

    event EventCreated(uint256 indexed eventId, uint256 maxSupply);
    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, bytes32 indexed orderRef);

    constructor(address initialOwner)
        ERC721("TixFour Ticket", "TIX4")
        Ownable(initialOwner)
    {}

    function createEvent(uint256 eventId, uint256 supply) external onlyOwner {
        require(!eventExists[eventId], "Event already exists");
        require(supply > 0, "Supply must be > 0");
        eventExists[eventId] = true;
        maxSupply[eventId] = supply;
        emit EventCreated(eventId, supply);
    }

    /// @param orderRef keccak256(order_id + "-" + index). Satu referensi hanya untuk satu tiket.
    function mint(address to, uint256 eventId, bytes32 orderRef)
        external
        onlyOwner
        returns (uint256)
    {
        require(eventExists[eventId], "Unknown event");
        require(tokenByRef[orderRef] == 0, "orderRef already used");
        require(mintedCount[eventId] < maxSupply[eventId], "Sold out");

        uint256 tokenId = _nextTokenId++;
        mintedCount[eventId] += 1;
        eventOf[tokenId] = eventId;
        tokenByRef[orderRef] = tokenId;

        _mint(to, tokenId);
        emit TicketMinted(tokenId, eventId, orderRef);
        return tokenId;
    }

    /// @dev Blokir semua perpindahan kepemilikan setelah mint (soulbound-style).
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        require(_ownerOf(tokenId) == address(0), "Ticket is non-transferable");
        return super._update(to, tokenId, auth);
    }
}
