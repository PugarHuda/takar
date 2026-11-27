// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./TakarSettle.sol";

/// @title TakarSettle v6: v5 plus Trade Assurance's buyer-side timing. Once the resolvers record
/// that the goods arrived, the buyer has `acceptWindow` to confirm (the supplier is paid at once) or
/// to object by disputing; if the buyer stays silent, anyone may release the payment to the supplier
/// when the window ends (Alibaba's automatic confirmation). An objection sends the deal to the
/// whole panel, as any dispute does in v5.
/// Inherited from v5: split settlement. A decision is the amount the payee receives
/// (0 to the full deal amount); the rest goes back to the payer. Built for quantity disputes:
/// the supplier says it delivered everything, the buyer accepted only part, and the panel pays
/// for what the evidence shows was accepted. Escalation is stricter than v4: once EITHER party has
/// disputed, a decision needs EVERY resolver, so a contested deal cannot be settled by the
/// resolvers of one operator alone.
/// @notice A payer locks tokens for a payee against a condition in plain words. After
/// `resolveAfter`, one resolver proposes a settlement with the Telegraph signal hashes it rests
/// on; the dispute window opens only once `threshold` DIFFERENT resolvers have seconded the same
/// decision on the same evidence. A party that disputes posts `bond`: if the deal later settles
/// at exactly the payout they disputed, the bond goes to the other party; otherwise the disputer
/// gets it back.
///
/// Rules the contract enforces:
///  - an Event deal needs at least two distinct non-zero signals; no signal repeats;
///  - a proposal needs `threshold` distinct resolvers agreeing on (decision, evidence hash);
///  - the payer and the payee may each dispute once, during liveness, by posting the bond;
///    a disputed evidence set cannot be proposed again;
///  - a payout never exceeds the deal amount; only the payee and the payer are ever paid;
///    bonds go only to a party;
///  - if nothing is finalized within GRACE after resolveAfter, the payer reclaims and every
///    bond goes back to whoever posted it.
/// @dev Testnet code, not audited. Resolvers are fixed at deploy; a new partner means a new instance.
contract TakarSettle6 {
    enum Kind { Event, Weather }
    enum State { Open, Proposed, Settled, Reclaimed }

    struct Deal {
        address payer;
        address payee;
        uint96 amount;
        uint64 resolveAfter;
        Kind kind;
        State state;
        uint96 payout; // the live proposal's decision: what the payee receives
        uint8 approvals; // resolvers who backed the live proposal
        uint64 finalizesAt; // 0 until the threshold is met
        bytes32 proposalHash; // keccak256(payout, signals)
        bytes32 disputedHash;
        uint96 payerBond; // held while the payer's dispute is unresolved
        uint96 payeeBond;
        uint96 payerBondOn; // the payout the payer disputed (set when payerBond > 0)
        uint96 payeeBondOn;
        bool payerDisputed; // one dispute per party, even with a zero bond
        bool payeeDisputed;
        string terms;
        uint64 acceptWindow; // seconds the buyer has after arrival; 0 = no automatic release
        uint64 arrivedAt; // set when `threshold` resolvers record arrival on the same evidence
        bytes32 arrivalHash; // keccak256(signals) of the arrival record being backed
        uint8 arrivalApprovals;
    }

    uint64 public constant GRACE = 7 days;
    uint256 public constant MAX_SIGNALS = 31;
    IERC20 public immutable token;
    uint64 public immutable liveness;
    uint96 public immutable bond;
    uint8 public immutable threshold;
    mapping(address => bool) public isResolver;
    address[] public resolvers;
    Deal[] internal deals;
    mapping(uint256 => mapping(address => bool)) internal backed; // deal -> resolver -> backed the live proposal
    mapping(uint256 => mapping(address => bool)) internal arrivalBacked; // deal -> resolver -> backed the arrival record

    event Opened(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, uint64 resolveAfter, Kind kind, string terms);
    event Proposed(uint256 indexed id, address indexed by, uint96 payout, bytes32[] signals, string evidence);
    event Seconded(uint256 indexed id, address indexed by, uint8 approvals, uint64 finalizesAt);
    event Disputed(uint256 indexed id, address by, uint256 bond);
    event Settled(uint256 indexed id, uint96 toPayee, uint96 toPayer, bytes32 proposalHash);
    event BondPaid(uint256 indexed id, address to, uint256 amount, bool returned);
    event Reclaimed(uint256 indexed id, address payer, uint256 amount);
    event Arrival(uint256 indexed id, address indexed by, bytes32[] signals, uint8 approvals, uint64 arrivedAt);
    event Confirmed(uint256 indexed id, address by);
    event AutoReleased(uint256 indexed id, address by);

    constructor(IERC20 token_, address[] memory resolvers_, uint8 threshold_, uint64 liveness_, uint96 bond_) {
        require(address(token_) != address(0), "zero token");
        require(threshold_ >= 1 && threshold_ <= resolvers_.length && resolvers_.length <= 16, "threshold");
        require(liveness_ > 0 && liveness_ < GRACE, "liveness");
        for (uint256 i = 0; i < resolvers_.length; i++) {
            require(resolvers_[i] != address(0) && !isResolver[resolvers_[i]], "resolver");
            isResolver[resolvers_[i]] = true;
        }
        resolvers = resolvers_;
        token = token_;
        threshold = threshold_;
        liveness = liveness_;
        bond = bond_;
    }

    function open(address payee, uint96 amount, uint64 resolveAfter, Kind kind, string calldata terms, uint64 acceptWindow) external returns (uint256 id) {
        require(acceptWindow < GRACE, "acceptWindow");
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
        d.acceptWindow = acceptWindow;
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Opened(id, msg.sender, payee, amount, resolveAfter, kind, terms);
    }

    function _hash(uint96 payout, bytes32[] calldata signals) internal pure returns (bytes32) {
        return keccak256(abi.encode(payout, signals));
    }

    /// @notice A resolver proposes a decision. With threshold 1 the dispute window opens at once.
    function propose(uint256 id, uint96 payout, bytes32[] calldata signals, string calldata evidence) external {
        require(isResolver[msg.sender], "only resolver");
        Deal storage d = deals[id];
        // A resolver who disagrees with a proposal that has not reached the threshold replaces it;
        // if the resolvers never converge, the payer reclaims after GRACE.
        require(d.state == State.Open || (d.state == State.Proposed && d.finalizesAt == 0), "not open");
        require(block.timestamp >= d.resolveAfter, "too early");
        require(block.timestamp < uint256(d.resolveAfter) + GRACE, "grace over");
        require(signals.length >= (d.kind == Kind.Event ? 2 : 1) && signals.length <= MAX_SIGNALS, "quorum");
        for (uint256 i = 0; i < signals.length; i++) {
            require(signals[i] != bytes32(0), "no evidence");
            for (uint256 j = 0; j < i; j++) require(signals[i] != signals[j], "repeated signal");
        }
        require(payout <= d.amount, "payout over amount");
        bytes32 h = _hash(payout, signals);
        require(h != d.disputedHash, "disputed evidence");
        _clearBackers(id);
        d.state = State.Proposed;
        d.payout = payout;
        d.proposalHash = h;
        d.approvals = 0;
        d.finalizesAt = 0;
        emit Proposed(id, msg.sender, payout, signals, evidence);
        _back(id, d);
    }

    /// @notice Another resolver backs the live proposal: same decision, same evidence.
    function second(uint256 id, bytes32 proposalHash) external {
        require(isResolver[msg.sender], "only resolver");
        Deal storage d = deals[id];
        require(d.state == State.Proposed, "not proposed");
        require(proposalHash == d.proposalHash, "different proposal");
        require(!backed[id][msg.sender], "already backed");
        _back(id, d);
    }

    /// @notice Approvals a decision on this deal needs: the threshold, or the whole panel once EITHER party has disputed.
    function required(uint256 id) public view returns (uint8) {
        Deal storage d = deals[id];
        return d.payerDisputed || d.payeeDisputed ? uint8(resolvers.length) : threshold;
    }

    function _back(uint256 id, Deal storage d) internal {
        backed[id][msg.sender] = true;
        d.approvals += 1;
        if (d.approvals == required(id)) d.finalizesAt = uint64(block.timestamp) + liveness;
        emit Seconded(id, msg.sender, d.approvals, d.finalizesAt);
    }

    function _clearBackers(uint256 id) internal {
        for (uint256 i = 0; i < resolvers.length; i++) backed[id][resolvers[i]] = false;
    }

    /// @notice A resolver records that the goods arrived, on the Telegraph signals it rests on (ship in
    /// port, the port's record). Arrival counts once `threshold` distinct resolvers back the same
    /// signals; different signals start a new record. It starts the buyer's acceptance window.
    function recordArrival(uint256 id, bytes32[] calldata signals) external {
        require(isResolver[msg.sender], "only resolver");
        Deal storage d = deals[id];
        require(d.state == State.Open && d.arrivedAt == 0, "not awaiting arrival");
        require(signals.length >= 2 && signals.length <= MAX_SIGNALS, "quorum");
        for (uint256 i = 0; i < signals.length; i++) {
            require(signals[i] != bytes32(0), "no evidence");
            for (uint256 j = 0; j < i; j++) require(signals[i] != signals[j], "repeated signal");
        }
        bytes32 h = keccak256(abi.encode(signals));
        if (h != d.arrivalHash) {
            for (uint256 i = 0; i < resolvers.length; i++) arrivalBacked[id][resolvers[i]] = false;
            d.arrivalHash = h;
            d.arrivalApprovals = 0;
        }
        require(!arrivalBacked[id][msg.sender], "already backed");
        arrivalBacked[id][msg.sender] = true;
        d.arrivalApprovals += 1;
        if (d.arrivalApprovals >= threshold) d.arrivedAt = uint64(block.timestamp);
        emit Arrival(id, msg.sender, signals, d.arrivalApprovals, d.arrivedAt);
    }

    /// @notice The buyer confirms receipt: the supplier is paid in full at once, and any bond returns.
    function confirm(uint256 id) external {
        Deal storage d = deals[id];
        require(msg.sender == d.payer, "only the buyer");
        require(d.state == State.Open || d.state == State.Proposed, "not payable");
        _payInFull(id, d);
        emit Confirmed(id, msg.sender);
    }

    /// @notice The buyer stayed silent through the acceptance window after a recorded arrival:
    /// anyone may release the payment to the supplier. Not after the buyer has objected, and not
    /// while a resolver proposal is pending.
    function autoRelease(uint256 id) external {
        Deal storage d = deals[id];
        require(d.state == State.Open && d.acceptWindow != 0 && d.arrivedAt != 0, "nothing to release");
        require(!d.payerDisputed, "buyer objected");
        require(block.timestamp >= uint256(d.arrivedAt) + d.acceptWindow, "window open");
        _payInFull(id, d);
        emit AutoReleased(id, msg.sender);
    }

    function _payInFull(uint256 id, Deal storage d) internal {
        d.state = State.Settled;
        d.payout = d.amount;
        require(token.transfer(d.payee, d.amount), "transfer failed");
        emit Settled(id, d.amount, 0, d.proposalHash);
        if (d.payerBond > 0) { _payBond(id, d.payer, d.payerBond, true); d.payerBond = 0; }
        if (d.payeeBond > 0) { _payBond(id, d.payee, d.payeeBond, true); d.payeeBond = 0; }
    }

    /// @notice The payer or the payee rejects the live proposal, once each, by posting the bond.
    /// In v6 the buyer may also object to an automatic release during its acceptance window: the
    /// deal then needs the whole panel, and the bond is lost if the panel pays in full anyway.
    function dispute(uint256 id) external {
        Deal storage d = deals[id];
        if (d.state == State.Open) {
            require(msg.sender == d.payer && d.arrivedAt != 0 && d.acceptWindow != 0, "nothing to dispute");
            require(block.timestamp < uint256(d.arrivedAt) + d.acceptWindow, "window over");
            require(!d.payerDisputed, "already disputed");
            d.payerDisputed = true; d.payerBond = bond; d.payerBondOn = d.amount;
            if (bond > 0) require(token.transferFrom(msg.sender, address(this), bond), "bond transfer failed");
            emit Disputed(id, msg.sender, bond);
            return;
        }
        require(d.state == State.Proposed, "nothing to dispute");
        // Before the threshold is met there is no window yet, and a dispute is allowed then too.
        require(d.finalizesAt == 0 || block.timestamp < d.finalizesAt, "liveness over");
        if (msg.sender == d.payer) { require(!d.payerDisputed, "already disputed"); d.payerDisputed = true; d.payerBond = bond; d.payerBondOn = d.payout; }
        else if (msg.sender == d.payee) { require(!d.payeeDisputed, "already disputed"); d.payeeDisputed = true; d.payeeBond = bond; d.payeeBondOn = d.payout; }
        else revert("not a party");
        if (bond > 0) require(token.transferFrom(msg.sender, address(this), bond), "bond transfer failed");
        d.state = State.Open;
        d.disputedHash = d.proposalHash;
        d.proposalHash = bytes32(0);
        d.finalizesAt = 0;
        d.approvals = 0;
        _clearBackers(id);
        emit Disputed(id, msg.sender, bond);
    }

    /// @notice Anyone pays out a proposal that reached the threshold once its liveness has passed.
    function finalize(uint256 id) external {
        Deal storage d = deals[id];
        require(d.state == State.Proposed, "not proposed");
        require(d.finalizesAt != 0, "threshold not met");
        require(block.timestamp >= d.finalizesAt, "liveness not over");
        d.state = State.Settled;
        uint96 rest = d.amount - d.payout;
        if (d.payout > 0) require(token.transfer(d.payee, d.payout), "transfer failed");
        if (rest > 0) require(token.transfer(d.payer, rest), "transfer failed");
        emit Settled(id, d.payout, rest, d.proposalHash);
        // A bond posted against the decision that stood goes to the other party; otherwise it returns.
        if (d.payerBond > 0) { bool lost = d.payerBondOn == d.payout; _payBond(id, lost ? d.payee : d.payer, d.payerBond, !lost); d.payerBond = 0; }
        if (d.payeeBond > 0) { bool lost = d.payeeBondOn == d.payout; _payBond(id, lost ? d.payer : d.payee, d.payeeBond, !lost); d.payeeBond = 0; }
    }

    function _payBond(uint256 id, address to, uint96 amount, bool returned) internal {
        require(token.transfer(to, amount), "bond transfer failed");
        emit BondPaid(id, to, amount, returned);
    }

    /// @notice Nothing finalized within GRACE: the payer takes the deal back and every bond returns.
    function reclaim(uint256 id) external {
        Deal storage d = deals[id];
        require(d.state == State.Open || (d.state == State.Proposed && d.finalizesAt == 0), "not reclaimable");
        require(block.timestamp >= uint256(d.resolveAfter) + GRACE, "grace not over");
        d.state = State.Reclaimed;
        require(token.transfer(d.payer, d.amount), "transfer failed");
        emit Reclaimed(id, d.payer, d.amount);
        if (d.payerBond > 0) { _payBond(id, d.payer, d.payerBond, true); d.payerBond = 0; }
        if (d.payeeBond > 0) { _payBond(id, d.payee, d.payeeBond, true); d.payeeBond = 0; }
    }

    function deal(uint256 id) external view returns (Deal memory) { return deals[id]; }
    function count() external view returns (uint256) { return deals.length; }
    function resolverCount() external view returns (uint256) { return resolvers.length; }
    function hasBacked(uint256 id, address r) external view returns (bool) { return backed[id][r]; }
}
