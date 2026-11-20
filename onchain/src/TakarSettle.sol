// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title TakarSettle: conditional payments settled by intelligence bought through Telegraph.
/// @notice A payer locks tokens for a payee against a condition, written in plain words in `terms`.
/// After `resolveAfter`, the resolver (Takar's agent) buys the answer through Telegraph and settles:
/// if the condition was met the payee is paid, otherwise the payer is refunded. The Telegraph signal
/// hash of the answer is recorded with the settlement, so anyone can read what was asked and answered.
/// @dev Trust: one resolver key decides. It cannot redirect funds (only the payee or the payer can be
/// paid), cannot settle early and cannot settle twice. If it never settles, the payer reclaims after
/// GRACE. Testnet code, not audited.
contract TakarSettle {
    enum Kind { Event, Weather }
    enum State { Open, Settled, Reclaimed }

    struct Deal {
        address payer;
        address payee;
        uint96 amount;
        uint64 resolveAfter;
        Kind kind;
        State state;
        string terms;
    }

    uint64 public constant GRACE = 7 days;
    IERC20 public immutable token;
    address public immutable resolver;
    Deal[] internal deals;

    event Opened(uint256 indexed id, address indexed payer, address indexed payee, uint256 amount, uint64 resolveAfter, Kind kind, string terms);
    event Settled(uint256 indexed id, bool conditionMet, address paidTo, uint256 amount, bytes32 signal, string evidence);
    event Reclaimed(uint256 indexed id, address payer, uint256 amount);

    constructor(IERC20 token_, address resolver_) {
        require(address(token_) != address(0) && resolver_ != address(0), "zero address");
        token = token_;
        resolver = resolver_;
    }

    function open(address payee, uint96 amount, uint64 resolveAfter, Kind kind, string calldata terms) external returns (uint256 id) {
        require(payee != address(0) && payee != msg.sender, "bad payee");
        require(amount > 0, "zero amount");
        require(resolveAfter > block.timestamp, "resolveAfter in the past");
        require(bytes(terms).length > 0 && bytes(terms).length <= 1000, "terms length");
        id = deals.length;
        deals.push(Deal(msg.sender, payee, amount, resolveAfter, kind, State.Open, terms));
        require(token.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit Opened(id, msg.sender, payee, amount, resolveAfter, kind, terms);
    }

    /// @param conditionMet true pays the payee, false refunds the payer.
    /// @param signal the Telegraph signal hash of the answer the decision rests on.
    function settle(uint256 id, bool conditionMet, bytes32 signal, string calldata evidence) external {
        require(msg.sender == resolver, "only resolver");
        Deal storage d = deals[id];
        require(d.state == State.Open, "not open");
        require(block.timestamp >= d.resolveAfter, "too early");
        require(signal != bytes32(0), "no evidence");
        d.state = State.Settled;
        address to = conditionMet ? d.payee : d.payer;
        require(token.transfer(to, d.amount), "transfer failed");
        emit Settled(id, conditionMet, to, d.amount, signal, evidence);
    }

    /// @notice If the resolver has not settled within GRACE after resolveAfter, the payer takes the money back.
    function reclaim(uint256 id) external {
        Deal storage d = deals[id];
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
