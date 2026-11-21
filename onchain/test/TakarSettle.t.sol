// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TakarSettle, IERC20} from "../src/TakarSettle.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}

contract TakarSettleTest is Test {
    MockUSDC usdc;
    TakarSettle s;
    address resolver = address(0xA11CE);
    address payer = address(0xB0B);
    address payee = address(0xCAFE);
    uint64 constant LIVE = 10 minutes;

    function setUp() public {
        usdc = new MockUSDC();
        s = new TakarSettle(IERC20(address(usdc)), resolver, LIVE);
        usdc.mint(payer, 100e6);
        vm.prank(payer);
        usdc.approve(address(s), type(uint256).max);
    }

    function _open(TakarSettle.Kind kind) internal returns (uint256 id) {
        vm.prank(payer);
        id = s.open(payee, 10e6, uint64(block.timestamp + 1 hours), kind, "pays if Argentina won the 2022 World Cup");
    }

    function _two(string memory a, string memory b) internal pure returns (bytes32[] memory sig) {
        sig = new bytes32[](2);
        sig[0] = keccak256(bytes(a));
        sig[1] = keccak256(bytes(b));
    }

    function _propose(uint256 id, bool met, bytes32[] memory sig) internal {
        vm.prank(resolver);
        s.propose(id, met, sig, "two miners resolved it yes");
    }

    function test_undisputedProposalPaysPayeeAfterLiveness() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.warp(block.timestamp + 1 hours);
        _propose(id, true, _two("a", "b"));
        vm.expectRevert("liveness not over");
        s.finalize(id);
        vm.warp(block.timestamp + LIVE);
        s.finalize(id); // anyone may finalize
        assertEq(usdc.balanceOf(payee), 10e6);
        assertEq(uint256(s.deal(id).state), uint256(TakarSettle.State.Settled));
    }

    function test_conditionNotMetRefundsPayer() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.warp(block.timestamp + 1 hours);
        _propose(id, false, _two("a", "b"));
        vm.warp(block.timestamp + LIVE);
        s.finalize(id);
        assertEq(usdc.balanceOf(payer), 100e6);
    }

    function test_eventNeedsTwoDistinctSignals() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.warp(block.timestamp + 1 hours);
        bytes32[] memory one = new bytes32[](1);
        one[0] = keccak256("a");
        vm.prank(resolver);
        vm.expectRevert("quorum");
        s.propose(id, true, one, "one miner");
        vm.prank(resolver);
        vm.expectRevert("repeated signal");
        s.propose(id, true, _two("a", "a"), "the same answer twice");
        bytes32[] memory zero = _two("a", "b");
        zero[1] = bytes32(0);
        vm.prank(resolver);
        vm.expectRevert("no evidence");
        s.propose(id, true, zero, "missing signal");
    }

    function test_weatherTakesOneSignal() public {
        uint256 id = _open(TakarSettle.Kind.Weather);
        vm.warp(block.timestamp + 1 hours);
        bytes32[] memory one = new bytes32[](1);
        one[0] = keccak256("day 1");
        vm.prank(resolver);
        s.propose(id, true, one, "13.8 mm, under 30 mm");
        assertEq(uint256(s.deal(id).state), uint256(TakarSettle.State.Proposed));
    }

    function test_disputeDiscardsProposalAndBlocksTheSameEvidence() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.warp(block.timestamp + 1 hours);
        _propose(id, true, _two("a", "b"));
        vm.prank(payer);
        s.dispute(id);
        assertEq(uint256(s.deal(id).state), uint256(TakarSettle.State.Open));
        vm.expectRevert("not proposed");
        s.finalize(id);
        vm.prank(resolver);
        vm.expectRevert("disputed evidence");
        s.propose(id, true, _two("a", "b"), "same again");
        _propose(id, true, _two("a", "c")); // a new answer from another miner
        vm.prank(payer);
        vm.expectRevert("already disputed");
        s.dispute(id);
        vm.prank(payee);
        s.dispute(id); // the other party still has its one dispute
        _propose(id, false, _two("d", "e"));
        vm.warp(block.timestamp + LIVE);
        s.finalize(id);
        assertEq(usdc.balanceOf(payer), 100e6);
    }

    function test_onlyPartiesDisputeAndOnlyDuringLiveness() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.warp(block.timestamp + 1 hours);
        _propose(id, true, _two("a", "b"));
        vm.prank(address(0xBAD));
        vm.expectRevert("not a party");
        s.dispute(id);
        vm.warp(block.timestamp + LIVE);
        vm.prank(payer);
        vm.expectRevert("liveness over");
        s.dispute(id);
    }

    function test_onlyResolverProposes() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(payee);
        vm.expectRevert("only resolver");
        s.propose(id, true, _two("a", "b"), "x");
    }

    function test_noEarlyProposal() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.prank(resolver);
        vm.expectRevert("too early");
        s.propose(id, true, _two("a", "b"), "x");
    }

    function test_noDoubleSettle() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.warp(block.timestamp + 1 hours);
        _propose(id, true, _two("a", "b"));
        vm.prank(resolver);
        vm.expectRevert("not open");
        s.propose(id, false, _two("c", "d"), "change of mind");
        vm.warp(block.timestamp + LIVE);
        s.finalize(id);
        vm.expectRevert("not proposed");
        s.finalize(id);
    }

    function test_reclaimOnlyAfterGraceAndOnlyWhenOpen() public {
        uint256 id = _open(TakarSettle.Kind.Event);
        vm.expectRevert("grace not over");
        s.reclaim(id);
        vm.warp(block.timestamp + 1 hours + 7 days);
        vm.prank(resolver);
        vm.expectRevert("grace over");
        s.propose(id, true, _two("a", "b"), "too late");
        s.reclaim(id);
        assertEq(usdc.balanceOf(payer), 100e6);
        vm.expectRevert("not open");
        s.reclaim(id);
    }

    function test_openRejectsBadInput() public {
        vm.startPrank(payer);
        vm.expectRevert("bad payee");
        s.open(payer, 1, uint64(block.timestamp + 1), TakarSettle.Kind.Event, "t");
        vm.expectRevert("zero amount");
        s.open(payee, 0, uint64(block.timestamp + 1), TakarSettle.Kind.Event, "t");
        vm.expectRevert("resolveAfter in the past");
        s.open(payee, 1, uint64(block.timestamp), TakarSettle.Kind.Event, "t");
        vm.stopPrank();
    }
}
