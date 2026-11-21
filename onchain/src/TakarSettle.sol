// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title TakarSettle v2: conditional payments settled by intelligence bought through Telegraph,
/// with a quorum of answers and a dispute window.
/// @notice A payer locks tokens for a payee against a condition written in plain words in `terms`.
/// After `resolveAfter`, the resolver (Takar's agent) buys the answer through Telegraph and
/// *proposes* a settlement carrying the Telegraph signal hashes it rests on. The proposal pays out
/// only after `liveness` has passed without a dispute (the optimistic-oracle pattern UMA uses).
///
/// Rules the contract enforces, not the resolver:
///  - an Event deal needs at least two distinct signals: two miners answered and agreed;
///  - every signal is non-zero and no signal repeats within a proposal;
///  - the payer and the payee may each dispute once, during liveness; a dispute discards the
///    proposal and the resolver must propose again, with a signal set that is not the one disputed;
///  - only the payee or the payer can ever be paid; nothing settles early or twice;
///  - if nothing is finalized within GRACE after resolveAfter, the payer reclaims.
/// @dev Testnet code, not audited.
contract TakarSettle {
    enum Kind { Event, Weather }
    enum State { Open, Proposed, Settled, Reclaimed }

    struct Deal {
        address payer;
        address payee;
        uint96 amount;
        uint64 resolveAfter;
        Kind kind;
        State state;
        bool conditionMet; // the live proposal's decision
        bool payerDisputed;
        bool payeeDisputed;
        uint64 finalizesAt; // end of the live proposal's dispute window
        bytes32 proposalHash; // keccak256 of the live proposal's signals
        bytes32 disputedHash; // the last disputed signal set, which cannot be proposed again
        string terms;
    }

    uint64 public constant GRACE = 7 days;
    uint256 public constant MAX_SIGNALS = 31; // a drought cover carries one signal per day
    IERC20 public immutable token;
    address public immutable resolver;
    uint64 public immutable liveness;
    Deal[] internal deals;

    event Opened(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, uint64 resolveAfter, Kind kind, string terms);
    event Proposed(uint256 indexed id, bool conditionMet, bytes32[] signals, string evidence, uint64 finalizesAt);
    event Disputed(uint256 indexed id, address by);
    event Settled(uint256 indexed id, bool conditionMet, address paidTo, uint256 amount, bytes32 proposalHash);
    event Reclaimed(uint256 indexed id, address payer, uint256 amount);

    constructor(IERC20 token_, address resolver_, uint64 liveness_) {
        require(address(token_) != address(0) && resolver_ != address(0), "zero address");
        require(liveness_ > 0 && liveness_ < GRACE, "liveness");
        token = token_;
        resolver = resolver_;
        liveness = liveness_;
    }

    function open(address payee, uint96 amount, uint64 resolveAfter, Kind kind, string calldata terms) external returns (uint256 id) {
        require(payee != address(0) && payee != msg.sender, "bad payee");
        require(amount > 0, "zero amount");
        require(resolveAfter > block.timestamp, "resolveAfter in the past");
        require(bytes(terms).length > 0 && bytes(terms).length <= 1000, "terms length");
        id = deals.length;
        Deal storage d = deals.push();
        d.payer = msg.sender;
        d.payee = payee;
        d.amount = amount;
        d.resolveAfter = resolveAfter;
        d.kind = kind;
        d.terms = terms;
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Opened(id, msg.sender, payee, amount, resolveAfter, kind, terms);
    }

    /// @param conditionMet true pays the payee, false refunds the payer, once liveness passes.
    /// @param signals the Telegraph signal hashes the decision rests on.
    function propose(uint256 id, bool conditionMet, bytes32[] calldata signals, string calldata evidence) external {
        require(msg.sender == resolver, "only resolver");
        Deal storage d = deals[id];
        require(d.state == State.Open, "not open");
        require(block.timestamp >= d.resolveAfter, "too early");
        require(block.timestamp < uint256(d.resolveAfter) + GRACE, "grace over");
        require(signals.length >= (d.kind == Kind.Event ? 2 : 1) && signals.length <= MAX_SIGNALS, "quorum");
        for (uint256 i = 0; i < signals.length; i++) {
            require(signals[i] != bytes32(0), "no evidence");
            for (uint256 j = 0; j < i; j++) require(signals[i] != signals[j], "repeated signal");
        }
        bytes32 h = keccak256(abi.encode(signals));
        require(h != d.disputedHash, "disputed evidence");
        d.state = State.Proposed;
        d.conditionMet = conditionMet;
        d.proposalHash = h;
        d.finalizesAt = uint64(block.timestamp) + liveness;
        emit Proposed(id, conditionMet, signals, evidence, d.finalizesAt);
    }

    /// @notice The payer or the payee rejects the live proposal, once each, during liveness.
    function dispute(uint256 id) external {
        Deal storage d = deals[id];
        require(d.state == State.Proposed, "nothing to dispute");
        require(block.timestamp < d.finalizesAt, "liveness over");
        if (msg.sender == d.payer) { require(!d.payerDisputed, "already disputed"); d.payerDisputed = true; }
        else if (msg.sender == d.payee) { require(!d.payeeDisputed, "already disputed"); d.payeeDisputed = true; }
        else revert("not a party");
        d.state = State.Open;
        d.disputedHash = d.proposalHash;
        d.proposalHash = bytes32(0);
        d.finalizesAt = 0;
        emit Disputed(id, msg.sender);
    }

    /// @notice Anyone pays out an undisputed proposal once its liveness has passed.
    function finalize(uint256 id) external {
        Deal storage d = deals[id];
        require(d.state == State.Proposed, "not proposed");
        require(block.timestamp >= d.finalizesAt, "liveness not over");
        d.state = State.Settled;
        address to = d.conditionMet ? d.payee : d.payer;
        require(token.transfer(to, d.amount), "transfer failed");
        emit Settled(id, d.conditionMet, to, d.amount, d.proposalHash);
    }

    /// @notice If nothing has been finalized within GRACE after resolveAfter, the payer takes the money back.
    function reclaim(uint256 id) external {
        Deal storage d = deals[id];
        // A live proposal always ends through finalize (anyone can call it), so only an
        // open deal, with no proposal standing, can be reclaimed.
        require(d.state == State.Open, "not open");
        require(block.timestamp >= uint256(d.resolveAfter) + GRACE, "grace not over");
        d.state = State.Reclaimed;
        require(token.transfer(d.payer, d.amount), "transfer failed");
        emit Reclaimed(id, d.payer, d.amount);
    }

    function deal(uint256 id) external view returns (Deal memory) {
        return deals[id];
    }

    function count() external view returns (uint256) {
        return deals.length;
    }
}
