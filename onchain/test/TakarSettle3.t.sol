// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TakarSettle3} from "../src/TakarSettle3.sol";
import {IERC20} from "../src/TakarSettle.sol";

contract MockUSDC3 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[to] += a; return true;
    }
}

contract TakarSettle3Test is Test {
    MockUSDC3 usdc;
    TakarSettle3 s;
    address r1 = address(0xA1);
    address r2 = address(0xA2);
    address r3 = address(0xA3);
    address payer = address(0xB0B);
    address payee = address(0xCAFE);
    uint64 constant LIVE = 10 minutes;
    uint96 constant BOND = 2e6;

    function setUp() public {
        usdc = new MockUSDC3();
        address[] memory rs = new address[](3);
        (rs[0], rs[1], rs[2]) = (r1, r2, r3);
        s = new TakarSettle3(IERC20(address(usdc)), rs, 2, LIVE, BOND);
        usdc.mint(payer, 100e6);
        usdc.mint(payee, 100e6);
        vm.prank(payer); usdc.approve(address(s), type(uint256).max);
        vm.prank(payee); usdc.approve(address(s), type(uint256).max);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(payer);
        id = s.open(payee, 10e6, uint64(block.timestamp + 1 hours), TakarSettle3.Kind.Event, "pays if the supplier is not sanctioned");
        vm.warp(block.timestamp + 1 hours);
    }

    function _sig(string memory a, string memory b) internal pure returns (bytes32[] memory sig) {
        sig = new bytes32[](2);
        sig[0] = keccak256(bytes(a));
        sig[1] = keccak256(bytes(b));
    }

    function _h(bool met, bytes32[] memory sig) internal pure returns (bytes32) { return keccak256(abi.encode(met, sig)); }

    function test_oneResolverIsNotEnough() public {
        uint256 id = _open();
        vm.prank(r1); s.propose(id, true, _sig("a", "b"), "two miners agree");
        assertEq(s.deal(id).finalizesAt, 0, "no window before the threshold");
        vm.warp(block.timestamp + LIVE + 1);
        vm.expectRevert("threshold not met");
        s.finalize(id);
    }

    function test_twoResolversThenFinalize() public {
        uint256 id = _open();
        bytes32[] memory sig = _sig("a", "b");
        vm.prank(r1); s.propose(id, true, sig, "two miners agree");
        vm.prank(r2); s.second(id, _h(true, sig));
        assertGt(s.deal(id).finalizesAt, 0);
        vm.warp(block.timestamp + LIVE);
        s.finalize(id);
        assertEq(usdc.balanceOf(payee), 110e6);
    }

    function test_secondMustMatchDecisionAndEvidence() public {
        uint256 id = _open();
        bytes32[] memory sig = _sig("a", "b");
        vm.prank(r1); s.propose(id, true, sig, "");
        vm.prank(r2); vm.expectRevert("different proposal"); s.second(id, _h(false, sig));
        vm.prank(r1); vm.expectRevert("already backed"); s.second(id, _h(true, sig));
        vm.prank(payer); vm.expectRevert("only resolver"); s.second(id, _h(true, sig));
    }

    function test_disagreeingResolverReplacesUnbackedProposal() public {
        uint256 id = _open();
        vm.prank(r1); s.propose(id, true, _sig("a", "b"), "");
        bytes32[] memory other = _sig("c", "d");
        vm.prank(r2); s.propose(id, false, other, "my two miners say listed");
        vm.prank(r3); s.second(id, _h(false, other));
        vm.warp(block.timestamp + LIVE);
        s.finalize(id);
        assertEq(usdc.balanceOf(payer), 100e6, "refunded");
    }

    function test_cannotReplaceOnceThresholdMet() public {
        uint256 id = _open();
        bytes32[] memory sig = _sig("a", "b");
        vm.prank(r1); s.propose(id, true, sig, "");
        vm.prank(r2); s.second(id, _h(true, sig));
        vm.prank(r3); vm.expectRevert("not open"); s.propose(id, false, _sig("c", "d"), "");
    }

    function test_wrongDisputeLosesBondToOtherParty() public {
        uint256 id = _open();
        bytes32[] memory sig = _sig("a", "b");
        vm.prank(r1); s.propose(id, true, sig, "");
        vm.prank(r2); s.second(id, _h(true, sig));
        vm.prank(payer); s.dispute(id); // the payer disputes "pay the payee"
        assertEq(usdc.balanceOf(payer), 88e6, "deal 10 and bond 2 locked");
        bytes32[] memory again = _sig("e", "f"); // fresh evidence, same decision
        vm.prank(r1); s.propose(id, true, again, "");
        vm.prank(r3); s.second(id, _h(true, again));
        vm.warp(block.timestamp + LIVE);
        s.finalize(id);
        assertEq(usdc.balanceOf(payee), 112e6, "deal plus the bond of the payer");
        assertEq(usdc.balanceOf(payer), 88e6);
    }

    function test_rightDisputeGetsBondBack() public {
        uint256 id = _open();
        bytes32[] memory sig = _sig("a", "b");
        vm.prank(r1); s.propose(id, true, sig, "");
        vm.prank(r2); s.second(id, _h(true, sig));
        vm.prank(payer); s.dispute(id);
        bytes32[] memory fixd = _sig("g", "h");
        vm.prank(r2); s.propose(id, false, fixd, "corrected");
        vm.prank(r3); s.second(id, _h(false, fixd));
        vm.warp(block.timestamp + LIVE);
        s.finalize(id);
        assertEq(usdc.balanceOf(payer), 100e6, "refund plus the bond back");
        assertEq(usdc.balanceOf(payee), 100e6);
    }

    function test_disputedEvidenceCannotReturnAndOneDisputeEach() public {
        uint256 id = _open();
        bytes32[] memory sig = _sig("a", "b");
        vm.prank(r1); s.propose(id, true, sig, "");
        vm.prank(payee); s.dispute(id);
        vm.prank(r1); vm.expectRevert("disputed evidence"); s.propose(id, true, sig, "");
        vm.prank(r1); s.propose(id, false, _sig("x", "y"), "");
        vm.prank(payee); vm.expectRevert("already disputed"); s.dispute(id);
        vm.prank(address(0xBAD)); vm.expectRevert("not a party"); s.dispute(id);
    }

    function test_noDisputeAfterLiveness() public {
        uint256 id = _open();
        bytes32[] memory sig = _sig("a", "b");
        vm.prank(r1); s.propose(id, true, sig, "");
        vm.prank(r2); s.second(id, _h(true, sig));
        vm.warp(block.timestamp + LIVE);
        vm.prank(payer); vm.expectRevert("liveness over"); s.dispute(id);
    }

    function test_reclaimReturnsBonds() public {
        uint256 id = _open();
        vm.prank(r1); s.propose(id, true, _sig("a", "b"), "");
        vm.prank(payer); s.dispute(id);
        vm.warp(block.timestamp + 7 days);
        s.reclaim(id);
        assertEq(usdc.balanceOf(payer), 100e6, "deal and bond back");
    }

    function test_eventNeedsTwoSignals() public {
        uint256 id = _open();
        bytes32[] memory one = new bytes32[](1);
        one[0] = keccak256("a");
        vm.prank(r1); vm.expectRevert("quorum"); s.propose(id, true, one, "");
        vm.prank(r1); vm.expectRevert("repeated signal"); s.propose(id, true, _sig("a", "a"), "");
    }

    function test_constructorRejectsBadSetup() public {
        address[] memory rs = new address[](2);
        (rs[0], rs[1]) = (r1, r1);
        vm.expectRevert("resolver");
        new TakarSettle3(IERC20(address(usdc)), rs, 2, LIVE, BOND);
        rs[1] = r2;
        vm.expectRevert("threshold");
        new TakarSettle3(IERC20(address(usdc)), rs, 3, LIVE, BOND);
    }
}
